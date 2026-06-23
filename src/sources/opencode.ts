import os from "os";
import path from "path";
import { openDatabase, queryAll, type Db } from "./sqlite";
import type { DailyActivity, ModelActivity, ProjectActivity, HourlyActivity, AgentStats, ParseOptions } from "../types";

const DEFAULT_DB_PATH = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

interface MessageActivitySummary {
  dailyActivity: DailyActivity[];
  modelActivity: ModelActivity[];
  hourlyActivity: HourlyActivity[];
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
  totalCache: number;
  totalCost: number;
  totalTurns: number;
  totalSessions: number;
}

export async function parse(dbPath?: string, modelFilter?: string, options: ParseOptions = {}): Promise<AgentStats | null> {
  const path = dbPath || DEFAULT_DB_PATH;
  try {
    const { db, close } = await openDatabase(path);
    const needle = modelFilter?.toLowerCase();

    let dailyActivity: DailyActivity[] = [];
    let projectActivity: ProjectActivity[] = [];
    let hourlyActivity: HourlyActivity[] = [];
    let modelActivity: ModelActivity[] = [];
    let totalTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCache = 0;
    let totalCost = 0;
    let totalTurns = 0;
    let totalSessions = 0;

    try {
      if (needle) {
        const fromMessages = readMessageActivity(db, { modelFilter: needle, needSessionCount: true });
        dailyActivity = fromMessages.dailyActivity;
        modelActivity = fromMessages.modelActivity;
        hourlyActivity = fromMessages.hourlyActivity;
        totalTokens = fromMessages.totalTokens;
        totalInput = fromMessages.totalInput;
        totalOutput = fromMessages.totalOutput;
        totalCache = fromMessages.totalCache;
        totalCost = fromMessages.totalCost;
        totalTurns = fromMessages.totalTurns;
        totalSessions = fromMessages.totalSessions;
        projectActivity = [];
      } else {
        try {
          const fromSessions = readSessionActivity(db);
          dailyActivity = fromSessions.dailyActivity;
          projectActivity = fromSessions.projectActivity;
          hourlyActivity = fromSessions.hourlyActivity;
          totalTokens = fromSessions.totalTokens;
          totalInput = fromSessions.totalInput;
          totalOutput = fromSessions.totalOutput;
          totalCache = fromSessions.totalCache;
          totalCost = fromSessions.totalCost;
          totalTurns = fromSessions.totalTurns;
          totalSessions = fromSessions.totalSessions;
        } catch {}

        // The message scan only feeds `modelActivity` (used by `--by model` and
        // `--json`) and the input/output/cache split (used by `--json`); it also
        // serves as the fallback source when the `session` table yields no tokens.
        // The common heatmap+stats run needs none of that, so skip the full
        // message-table scan entirely.
        const needModelDetail = options.by === "model" || options.json === true;
        if (needModelDetail || totalTokens === 0) {
          try {
            const fromMessages = readMessageActivity(db, { needSessionCount: totalTokens === 0 });
            modelActivity = fromMessages.modelActivity;

            if (totalTokens === 0 && fromMessages.totalTokens > 0) {
              dailyActivity = fromMessages.dailyActivity;
              hourlyActivity = fromMessages.hourlyActivity;
              totalTokens = fromMessages.totalTokens;
              totalInput = fromMessages.totalInput;
              totalOutput = fromMessages.totalOutput;
              totalCache = fromMessages.totalCache;
              totalCost = fromMessages.totalCost;
              totalTurns = fromMessages.totalTurns;
              totalSessions = fromMessages.totalSessions;
            }
          } catch {}
        }
      }
    } finally {
      close();
    }

    if (needle && totalTokens === 0) {
      return null;
    }

    const activeDays = dailyActivity.length;
    const bestDay = dailyActivity.reduce(
      (best, d) => (d.tokens > best.tokens ? d : best),
      { date: "", tokens: 0 }
    );

    return {
      harness: "opencode",
      sourcePath: path,
      totalTokens,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheTokens: totalCache,
      totalCost,
      totalTurns,
      totalSessions,
      activeDays,
      currentStreak: 0,
      longestStreak: 0,
      bestDay,
      dailyActivity,
      modelActivity,
      projectActivity,
      hourlyActivity,
    };
  } catch {
    return null;
  }
}

function readSessionActivity(db: any): {
  dailyActivity: DailyActivity[];
  projectActivity: ProjectActivity[];
  hourlyActivity: HourlyActivity[];
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
  totalCache: number;
  totalCost: number;
  totalTurns: number;
  totalSessions: number;
} {
  const columns = getTableColumns(db, "session");
  if (columns.length === 0) throw new Error("session table not found");

  const col = (name: string) => columns.includes(name);

  const tokenCols = ["tokens_input", "tokens_output", "tokens_reasoning", "tokens_cache_read", "tokens_cache_write"]
    .filter(col);
  if (tokenCols.length === 0) throw new Error("no token columns in session table");

  const tokensExpr = tokenCols.join(" + ");
  const inputExpr = col("tokens_input") ? "SUM(tokens_input)" : "0";
  const outputExpr = col("tokens_output") ? "SUM(tokens_output)" : "0";
  const cacheParts: string[] = [];
  if (col("tokens_cache_read")) cacheParts.push("tokens_cache_read");
  if (col("tokens_cache_write")) cacheParts.push("tokens_cache_write");
  const cacheExpr = cacheParts.length > 0 ? `SUM(${cacheParts.join(" + ")})` : "0";
  const costExpr = col("cost") ? "SUM(cost)" : "0";

  const sessions = queryAll(db, `
    SELECT
      DATE(time_created / 1000, 'unixepoch', 'localtime') as date,
      ${inputExpr} as input_tokens,
      ${outputExpr} as output_tokens,
      ${cacheExpr} as cache_tokens,
      SUM(${tokensExpr}) as tokens,
      ${costExpr} as cost,
      COUNT(*) as session_count
    FROM session
    GROUP BY date
    ORDER BY date
  `) as any[];

  const projectActivity: ProjectActivity[] = col("directory") ? (queryAll(db, `
    SELECT
      directory as project,
      SUM(${tokensExpr}) as tokens
    FROM session
    GROUP BY project
    ORDER BY tokens DESC
  `) as any[]).filter((r: any) => r.project && r.tokens > 0).map((r: any) => ({
    project: r.project === "/" ? "(global)" : r.project,
    harness: "opencode" as const,
    tokens: r.tokens,
  })) : [];

  const hourlyRows = queryAll(db, `
    SELECT
      CAST(STRFTIME('%H', time_created / 1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
      SUM(${tokensExpr}) as tokens,
      COUNT(*) as turns
    FROM session
    GROUP BY hour
    ORDER BY hour
  `) as any[];

  const dailyActivity = sessions
    .filter((r: any) => r.date && r.tokens > 0)
    .map((r: any) => ({
      date: r.date,
      tokens: r.tokens,
      turns: r.session_count,
      cost: r.cost || 0,
    }));

  const hourlyActivity = hourlyRows.map((r: any) => ({
    hour: r.hour,
    tokens: r.tokens,
    turns: r.turns,
  }));

  return {
    dailyActivity,
    projectActivity,
    hourlyActivity,
    totalTokens: dailyActivity.reduce((s, d) => s + d.tokens, 0),
    totalInput: sessions.reduce((s: number, r: any) => s + (r.input_tokens || 0), 0),
    totalOutput: sessions.reduce((s: number, r: any) => s + (r.output_tokens || 0), 0),
    totalCache: sessions.reduce((s: number, r: any) => s + (r.cache_tokens || 0), 0),
    totalCost: dailyActivity.reduce((s, d) => s + d.cost, 0),
    totalTurns: dailyActivity.reduce((s, d) => s + d.turns, 0),
    totalSessions: sessions.reduce((s: number, r: any) => s + (r.session_count || 0), 0),
  };
}

// Per-row token total: input + output + reasoning + cache.read + cache.write,
// each missing field coalesced to 0 (mirrors the JS `t.field || 0` reader).
const MESSAGE_ROW_TOKENS = `(
        COALESCE(json_extract(data, '$.tokens.input'), 0)
      + COALESCE(json_extract(data, '$.tokens.output'), 0)
      + COALESCE(json_extract(data, '$.tokens.reasoning'), 0)
      + COALESCE(json_extract(data, '$.tokens.cache.read'), 0)
      + COALESCE(json_extract(data, '$.tokens.cache.write'), 0)
    )`;

// Only assistant rows that actually carry a `tokens` object qualify; the
// per-row token total is filtered to > 0 separately (matching the JS reader's
// `if (tokens === 0) continue`).
const MESSAGE_QUALIFIES = `json_extract(data, '$.role') = 'assistant' AND json_extract(data, '$.tokens') IS NOT NULL`;

interface GroupedMessageRow {
  date: string | null;
  hour: number;
  model: string | null;
  tokens: number;
  input: number;
  output: number;
  cache: number;
  cost: number;
  turns: number;
}

function readMessageActivity(
  db: Db,
  opts: { modelFilter?: string; needSessionCount: boolean }
): MessageActivitySummary {
  const msgColumns = getTableColumns(db, "message");
  if (msgColumns.length === 0) throw new Error("message table not found");

  const hasTimeCreated = msgColumns.includes("time_created");
  const hasSessionId = msgColumns.includes("session_id");

  // JSON `$.time.created` takes precedence over the `time_created` column
  // (preserved from the per-row JS reader — see the "prefers JSON time" test).
  const timeExpr = hasTimeCreated
    ? "COALESCE(CAST(json_extract(data, '$.time.created') AS INTEGER), time_created)"
    : "CAST(json_extract(data, '$.time.created') AS INTEGER)";

  // Single bound param: a case-insensitive *literal* substring match on modelID,
  // mirroring JS `model.toLowerCase().includes(needle)`. `instr` is literal, so
  // any LIKE wildcards in the needle are matched verbatim. A null modelID is
  // treated as "unknown" so it matches exactly when the JS path would.
  const needle = opts.modelFilter?.toLowerCase();
  const params: any[] = [];
  let modelClause = "";
  if (needle) {
    modelClause = "AND instr(lower(COALESCE(json_extract(data, '$.modelID'), 'unknown')), ?) > 0";
    params.push(needle);
  }

  // Aggregate entirely in SQLite: json_extract runs in C and we transfer a
  // compact (date × hour × model) result instead of every raw row + a JS
  // JSON.parse. The inner subquery materializes per-row date/hour/model/tokens
  // so the outer query can drop zero-token rows before grouping.
  //
  // `WHERE row_tokens > 0 AND date IS NOT NULL`: the first matches the JS
  // reader's `if (tokens === 0) continue`. The second drops rows with no
  // resolvable timestamp (neither `time_created` nor `$.time.created`). The old
  // JS reader bucketed those under `Date.now()` — i.e. "today", which made the
  // same DB render differently depending on the run date; excluding them is
  // deterministic. Real OpenCode DBs have none of these rows, and
  // countMessageSessions applies the identical filter so totals stay consistent.
  const rows = queryAll(db, `
    SELECT date, hour, model,
      SUM(row_tokens) AS tokens,
      SUM(row_input)  AS input,
      SUM(row_output) AS output,
      SUM(row_cache)  AS cache,
      SUM(row_cost)   AS cost,
      COUNT(*)        AS turns
    FROM (
      SELECT
        DATE(t / 1000, 'unixepoch', 'localtime') AS date,
        CAST(STRFTIME('%H', t / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
        json_extract(data, '$.modelID') AS model,
        ${MESSAGE_ROW_TOKENS} AS row_tokens,
        COALESCE(json_extract(data, '$.tokens.input'), 0)  AS row_input,
        COALESCE(json_extract(data, '$.tokens.output'), 0) AS row_output,
        COALESCE(json_extract(data, '$.tokens.cache.read'), 0)
          + COALESCE(json_extract(data, '$.tokens.cache.write'), 0) AS row_cache,
        COALESCE(json_extract(data, '$.cost'), 0) AS row_cost
      FROM (SELECT data, ${timeExpr} AS t FROM message)
      WHERE ${MESSAGE_QUALIFIES} ${modelClause}
    )
    WHERE row_tokens > 0 AND date IS NOT NULL
    GROUP BY date, hour, model
  `, params) as GroupedMessageRow[];

  const dailyMap = new Map<string, { tokens: number; turns: number; cost: number }>();
  const modelMap = new Map<string, { tokens: number; input: number; output: number; cache: number; cost: number }>();
  const hourlyMap = new Map<number, { tokens: number; turns: number }>();

  let totalTokens = 0;
  let totalTurns = 0;

  for (const row of rows) {
    const date = String(row.date);
    const hour = Number(row.hour);
    const model = row.model || "unknown";
    const tokens = Number(row.tokens) || 0;
    const turns = Number(row.turns) || 0;
    const cost = Number(row.cost) || 0;

    const daily = dailyMap.get(date) || { tokens: 0, turns: 0, cost: 0 };
    daily.tokens += tokens;
    daily.turns += turns;
    daily.cost += cost;
    dailyMap.set(date, daily);

    const modelEntry = modelMap.get(model) || { tokens: 0, input: 0, output: 0, cache: 0, cost: 0 };
    modelEntry.tokens += tokens;
    modelEntry.input += Number(row.input) || 0;
    modelEntry.output += Number(row.output) || 0;
    modelEntry.cache += Number(row.cache) || 0;
    modelEntry.cost += cost;
    modelMap.set(model, modelEntry);

    const hourly = hourlyMap.get(hour) || { tokens: 0, turns: 0 };
    hourly.tokens += tokens;
    hourly.turns += turns;
    hourlyMap.set(hour, hourly);

    totalTokens += tokens;
    totalTurns += turns;
  }

  const dailyActivity = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, tokens: v.tokens, turns: v.turns, cost: v.cost }));

  const modelActivity = Array.from(modelMap.entries())
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .map(([model, v]) => ({
      model,
      harness: "opencode" as const,
      tokens: v.tokens,
      inputTokens: v.input,
      outputTokens: v.output,
      cacheTokens: v.cache,
      cost: v.cost,
    }));

  const hourlyActivity = Array.from(hourlyMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([hour, v]) => ({ hour, tokens: v.tokens, turns: v.turns }));

  // Distinct session count is needed only when the message scan is the totals
  // source (`--model` filter or the no-session-tokens fallback); the common
  // `--by model` / `--json` path keeps the session table's count, so skip the
  // extra scan there. When skipped, `totalSessions` is a turn-count placeholder
  // the caller does not read — only consume it when `needSessionCount` was true.
  const totalSessions = opts.needSessionCount
    ? countMessageSessions(db, hasSessionId, modelClause, params, timeExpr) || totalTurns
    : totalTurns;

  return {
    dailyActivity,
    modelActivity,
    hourlyActivity,
    totalTokens,
    totalInput: modelActivity.reduce((s, m) => s + m.inputTokens, 0),
    totalOutput: modelActivity.reduce((s, m) => s + m.outputTokens, 0),
    totalCache: modelActivity.reduce((s, m) => s + m.cacheTokens, 0),
    totalCost: modelActivity.reduce((s, m) => s + m.cost, 0),
    totalTurns,
    totalSessions,
  };
}

// COUNT(DISTINCT session_id) over EXACTLY the same qualifying rows the grouped
// query counts (assistant, has tokens, optional model filter, row_tokens > 0,
// and a resolvable timestamp), mirroring the JS `sessionIds.size` (non-null,
// non-empty ids only). The `DATE(...) IS NOT NULL` clause must match the grouped
// query's `date IS NOT NULL` filter — otherwise a session whose only token rows
// lack a timestamp would be counted here yet contribute nothing to the token
// totals. Returns 0 when there is no usable session_id column so the caller
// falls back to the turn count, matching `sessionIds.size || totalTurns`.
function countMessageSessions(db: Db, hasSessionId: boolean, modelClause: string, params: any[], timeExpr: string): number {
  if (!hasSessionId) return 0;
  const rows = queryAll(db, `
    SELECT COUNT(DISTINCT session_id) AS sessions
    FROM (SELECT session_id, data, ${timeExpr} AS t FROM message)
    WHERE ${MESSAGE_QUALIFIES}
      AND session_id IS NOT NULL AND session_id <> ''
      ${modelClause}
      AND ${MESSAGE_ROW_TOKENS} > 0
      AND DATE(t / 1000, 'unixepoch', 'localtime') IS NOT NULL
  `, params) as Array<{ sessions: number }>;
  return Number(rows[0]?.sessions) || 0;
}

function getTableColumns(db: any, tableName: string): string[] {
  try {
    return (queryAll(db, `PRAGMA table_info(${tableName})`) as Array<{ name: string }>).map(c => c.name);
  } catch {
    return [];
  }
}
