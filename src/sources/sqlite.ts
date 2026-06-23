import fs from "fs";

// SQLite driver abstraction.
//
// Callers go through `openDatabase` + `queryAll` only. We prefer a native,
// path-based driver — Bun's `bun:sqlite` or Node's built-in `node:sqlite`
// (Node >= 22.5) — which open the file by path and read only the pages a
// query touches (and apply the WAL). On a multi-GB OpenCode DB that is tens
// of MB instead of the whole file. We fall back to `sql.js` (pure-WASM,
// whole-file-in-memory) so the tool still runs where no native driver exists
// (Node < 22.5, Deno) or a read-only open fails (read-only media, locked DB).
//
// See sql.js.d.ts for the module declaration backing import("sql.js").

export interface Db {
  all(sql: string, params?: any[]): any[];
}

// Built with `.join` so bundlers / test transformers (esbuild, Vite/vitest)
// cannot statically resolve these runtime-only specifiers: `bun:sqlite` only
// exists in the Bun runtime, `node:sqlite` only in Node >= 22.5. Paired with
// `@vite-ignore` on the dynamic imports below.
const BUN_SQLITE = ["bun", "sqlite"].join(":");
const NODE_SQLITE = ["node", "sqlite"].join(":");

export async function openDatabase(filePath: string): Promise<{ db: Db; close: () => void }> {
  if (process.env.VOM_SQLITE_DRIVER !== "sqljs") {
    if (typeof (globalThis as any).Bun !== "undefined") {
      try {
        return await openWithBun(filePath);
      } catch {
        // Bun present but the open failed (e.g. read-only media) -> fall back.
      }
    } else {
      const native = await tryOpenWithNode(filePath);
      if (native) return native;
    }
  }
  return openWithSqlJs(filePath);
}

export function queryAll(db: Db, sql: string, params?: any[]): any[] {
  return db.all(sql, params);
}

// Each driver wraps its native handle into the same { db, close } shape.
// `all` takes optional positional bind params (for `?` placeholders).
function makeDb(all: (sql: string, params?: any[]) => any[], close: () => void): { db: Db; close: () => void } {
  return { db: { all }, close };
}

// ---- Bun: bun:sqlite -----------------------------------------------------

async function openWithBun(filePath: string): Promise<{ db: Db; close: () => void }> {
  const { Database } = await import(/* @vite-ignore */ BUN_SQLITE);
  const d = new Database(filePath, { readonly: true });
  return makeDb((sql, params) => d.query(sql).all(...(params ?? [])), () => d.close());
}

// ---- Node: node:sqlite (Node >= 22.5) ------------------------------------

async function tryOpenWithNode(filePath: string): Promise<{ db: Db; close: () => void } | null> {
  let DatabaseSync: any;
  const restoreWarnings = silenceSqliteExperimentalWarning();
  try {
    ({ DatabaseSync } = await import(/* @vite-ignore */ NODE_SQLITE));
  } catch {
    return null; // node:sqlite unavailable (Node < 22.5, Deno, ...) -> next driver
  } finally {
    restoreWarnings();
  }

  try {
    const d = new DatabaseSync(filePath, { readOnly: true });
    return makeDb((sql, params) => d.prepare(sql).all(...(params ?? [])), () => d.close());
  } catch {
    return null; // open failed (missing file, read-only media, lock) -> fall back
  }
}

// node:sqlite emits `ExperimentalWarning: SQLite is an experimental feature`
// on first import. A `process.on('warning')` listener cannot suppress the
// default stderr print, so we filter `process.emitWarning` (which is called
// synchronously during the import) and restore it once the last open is done.
//
// Reference-counted: `collectAll` opens the OpenCode and Codex DBs concurrently
// (registry.ts), so two `tryOpenWithNode` calls interleave around the
// `await import`. A naive per-call save/restore would capture an already-patched
// function and leave a wrapper installed on the global forever; the counter
// ensures exactly one patch is installed and the original is restored only when
// the final concurrent open releases it.
let emitWarningDepth = 0;
let nativeEmitWarning: typeof process.emitWarning | null = null;

function silenceSqliteExperimentalWarning(): () => void {
  if (emitWarningDepth++ === 0) {
    const original = (nativeEmitWarning = process.emitWarning);
    process.emitWarning = function (warning: any, ...rest: any[]): void {
      const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
      const message = typeof warning === "string" ? warning : warning?.message;
      if (type === "ExperimentalWarning" && typeof message === "string" && message.includes("SQLite")) {
        return;
      }
      (original as any).apply(process, [warning, ...rest]);
    } as typeof process.emitWarning;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--emitWarningDepth === 0 && nativeEmitWarning) {
      process.emitWarning = nativeEmitWarning;
      nativeEmitWarning = null;
    }
  };
}

// ---- Fallback: sql.js (pure WASM, whole file in memory) ------------------

interface SqlJsDatabase {
  prepare(sql: string): SqlJsStatement;
  close(): void;
}

interface SqlJsStatement {
  bind(values: any[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, any>;
  free(): void;
}

interface SqlJsStatic {
  Database: new (data: ArrayLike<number | bigint>) => SqlJsDatabase;
}

let SQL: SqlJsStatic | null = null;
let SQL_PROMISE: Promise<SqlJsStatic> | null = null;

async function getSQL(): Promise<SqlJsStatic> {
  if (SQL) return SQL;

  if (!SQL_PROMISE) {
    SQL_PROMISE = (async () => {
      const initSqlJs = (await import("sql.js")).default as (options?: any) => Promise<SqlJsStatic>;
      SQL = await initSqlJs();
      return SQL;
    })();
  }

  try {
    return await SQL_PROMISE;
  } catch (error) {
    SQL_PROMISE = null;
    throw error;
  }
}

async function readLargeFile(filePath: string): Promise<Buffer> {
  const { size } = await fs.promises.stat(filePath);
  const chunks: Buffer[] = [];
  const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 * 1024 });
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks, size);
}

export async function openWithSqlJs(filePath: string): Promise<{ db: Db; close: () => void }> {
  const sql = await getSQL();
  const buffer = await readLargeFile(filePath);
  const raw = new sql.Database(buffer);
  return makeDb((query, params) => queryAllSqlJs(raw, query, params), () => raw.close());
}

function queryAllSqlJs(raw: SqlJsDatabase, sql: string, params?: any[]): any[] {
  const stmt = raw.prepare(sql);
  try {
    if (params && params.length > 0) stmt.bind(params);
    const rows: any[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
  }
}
