import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, openWithSqlJs, queryAll } from "../src/sources/sqlite";

const tempDirs: string[] = [];

afterEach(() => {
  delete process.env.VOM_SQLITE_DRIVER;
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

// Author a real on-disk SQLite file the same way the source fixtures do:
// build it with sql.js, then read it back through whichever driver
// openDatabase selects (node:sqlite under vitest) — and through sql.js.
async function writeFixtureDb(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-sqlite-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "fixture.db");

  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE session (
    time_created INTEGER NOT NULL,
    directory TEXT,
    tokens_input INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    cost REAL DEFAULT 0
  );`);
  db.run("INSERT INTO session VALUES (?, ?, ?, ?, ?)", [
    new Date(2026, 5, 1, 10, 0).getTime(),
    "/home/alice/app",
    200,
    100,
    0.15,
  ]);
  db.run(`CREATE TABLE message (time_created INTEGER NOT NULL, data TEXT NOT NULL);`);
  db.run("INSERT INTO message VALUES (?, ?)", [
    new Date(2026, 5, 1, 10, 15).getTime(),
    JSON.stringify({ role: "assistant", modelID: "gpt-5", tokens: { input: 100, output: 50 } }),
  ]);
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  return dbPath;
}

// Exercises every SQL feature the parsers depend on through the Db abstraction.
function readFixture(db: { all(sql: string): any[] }) {
  const columns = (queryAll(db, "PRAGMA table_info(session)") as Array<{ name: string }>).map((c) => c.name);

  const sessions = queryAll(db, `
    SELECT
      DATE(time_created / 1000, 'unixepoch', 'localtime') as date,
      CAST(STRFTIME('%H', time_created / 1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
      SUM(tokens_input + tokens_output) as tokens,
      SUM(cost) as cost,
      COUNT(*) as session_count
    FROM session
    GROUP BY date
  `);

  const messages = queryAll(db, `
    SELECT json_extract(data, '$.modelID') as model,
           CAST(json_extract(data, '$.tokens.input') AS INTEGER) as input
    FROM message
    WHERE json_extract(data, '$.role') = 'assistant'
  `);

  return { columns, sessions, messages };
}

describe("sqlite driver abstraction", () => {
  it("opens a fixture DB through the active driver and runs PRAGMA/DATE/STRFTIME/json_extract", async () => {
    const dbPath = await writeFixtureDb();
    const { db, close } = await openDatabase(dbPath);
    try {
      const { columns, sessions, messages } = readFixture(db);

      expect(columns).toEqual(["time_created", "directory", "tokens_input", "tokens_output", "cost"]);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ date: "2026-06-01", hour: 10, tokens: 300, session_count: 1 });
      expect(sessions[0].cost).toBeCloseTo(0.15);
      // Integer columns must come back as JS numbers, not BigInt.
      expect(typeof sessions[0].tokens).toBe("number");
      expect(typeof sessions[0].hour).toBe("number");
      expect(messages).toEqual([{ model: "gpt-5", input: 100 }]);
    } finally {
      close();
    }
  });

  it("still works when forced onto the sql.js fallback", async () => {
    const dbPath = await writeFixtureDb();
    process.env.VOM_SQLITE_DRIVER = "sqljs";
    const { db, close } = await openDatabase(dbPath);
    try {
      const { columns, sessions, messages } = readFixture(db);
      expect(columns).toEqual(["time_created", "directory", "tokens_input", "tokens_output", "cost"]);
      expect(sessions[0]).toMatchObject({ date: "2026-06-01", hour: 10, tokens: 300, session_count: 1 });
      expect(messages).toEqual([{ model: "gpt-5", input: 100 }]);
    } finally {
      close();
    }
  });

  it("produces identical results across the active driver and the sql.js fallback", async () => {
    const dbPath = await writeFixtureDb();

    const active = await openDatabase(dbPath);
    const fromActive = readFixture(active.db);
    active.close();

    const fallback = await openWithSqlJs(dbPath);
    const fromFallback = readFixture(fallback.db);
    fallback.close();

    expect(fromActive.columns).toEqual(fromFallback.columns);
    expect(fromActive.sessions).toEqual(fromFallback.sessions);
    expect(fromActive.messages).toEqual(fromFallback.messages);
  });

  it("binds positional params identically across the active driver and the sql.js fallback", async () => {
    const dbPath = await writeFixtureDb();
    // The fixture has exactly one assistant message, modelID "gpt-5".
    const matching = (db: { all(sql: string, params?: any[]): any[] }) =>
      queryAll(
        db,
        "SELECT json_extract(data, '$.modelID') AS model FROM message WHERE instr(lower(json_extract(data, '$.modelID')), ?) > 0",
        ["gpt"]
      );
    const nonMatching = (db: { all(sql: string, params?: any[]): any[] }) =>
      queryAll(db, "SELECT 1 AS x FROM message WHERE instr(lower(json_extract(data, '$.modelID')), ?) > 0", ["zzz"]);

    const active = await openDatabase(dbPath);
    const activeMatch = matching(active.db);
    const activeNone = nonMatching(active.db);
    active.close();

    process.env.VOM_SQLITE_DRIVER = "sqljs";
    const fallback = await openWithSqlJs(dbPath);
    const fallbackMatch = matching(fallback.db);
    const fallbackNone = nonMatching(fallback.db);
    fallback.close();

    // The bound param is actually applied (matching needle returns the row, a
    // non-matching needle returns nothing) and both drivers agree.
    expect(activeMatch).toEqual([{ model: "gpt-5" }]);
    expect(fallbackMatch).toEqual([{ model: "gpt-5" }]);
    expect(activeNone).toEqual([]);
    expect(fallbackNone).toEqual([]);
  });

  it("throws for a nonexistent path (so callers fall back / return null)", async () => {
    await expect(openDatabase("/nonexistent/path/fixture.db")).rejects.toBeDefined();
  });

  it("restores process.emitWarning after concurrent opens (no leaked global wrapper)", async () => {
    // Mirrors registry.collectAll opening the OpenCode and Codex DBs at once.
    const a = await writeFixtureDb();
    const b = await writeFixtureDb();
    const original = process.emitWarning;

    const [r1, r2] = await Promise.all([openDatabase(a), openDatabase(b)]);
    r1.close();
    r2.close();

    expect(process.emitWarning).toBe(original);
  });
});
