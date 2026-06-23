import { openDatabase, queryAll } from "./sqlite";
import fs from "fs";
import os from "os";
import path from "path";
import type { DailyActivity, ModelActivity, ProjectActivity, HourlyActivity, AgentStats, ParseOptions } from "../types";
import { formatDateLocal } from "../render/format";
import { collectJsonlFiles } from "./files";

const DEFAULT_DB_PATH = path.join(os.homedir(), ".codex", "state_5.sqlite");
const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");

interface RolloutTokens {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

interface CodexPaths {
  dbFile: string;
  sessionsDir: string;
  sourcePath: string;
}

interface RolloutSummary {
  usage: RolloutTokens;
  timestamp: string | null;
  model: string;
  project: string;
}

function findRolloutForThread(rolloutFiles: string[], threadId: string): string | null {
  return rolloutFiles.find((file) => path.basename(file).includes(threadId)) || null;
}

// Real Codex rollout filenames embed the thread UUID
// (`rollout-<timestamp>-<uuid>.jsonl`), so index the files by that UUID once and
// resolve a rollout-less thread in O(1) instead of re-scanning every file per
// thread (the old O(threads × files)). Filenames without a UUID (e.g. the test
// fixtures) are left unindexed and fall through to the original substring scan,
// so the matching semantics are unchanged.
const ROLLOUT_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function buildRolloutIndex(rolloutFiles: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const file of rolloutFiles) {
    const match = ROLLOUT_UUID_RE.exec(path.basename(file));
    if (match && !index.has(match[0])) index.set(match[0], file);
  }
  return index;
}

function resolveRolloutPath(
  sessionsDir: string,
  thread: { id: string; rollout_path?: string | null },
  findByThreadId: (threadId: string) => string | null
): string | null {
  if (thread.rollout_path) {
    if (fs.existsSync(thread.rollout_path)) return thread.rollout_path;

    if (!path.isAbsolute(thread.rollout_path)) {
      const relativePath = path.join(sessionsDir, thread.rollout_path);
      if (fs.existsSync(relativePath)) return relativePath;
    }
  }

  return findByThreadId(thread.id);
}

export async function parse(dbPath?: string, sessionsDir?: string, modelFilter?: string, options: ParseOptions = {}): Promise<AgentStats | null> {
  const paths = resolveCodexPaths(dbPath, sessionsDir);
  const dbFile = paths.dbFile;
  const sessDir = paths.sessionsDir;
  try {
    const { db, close } = await openDatabase(dbFile);
    let threads: any[] = [];
    try {
      const threadColumns = new Set(
        (queryAll(db, "PRAGMA table_info(threads)") as any[]).map((column) => String(column.name))
      );
      const rolloutPathColumn = threadColumns.has("rollout_path") ? "rollout_path" : "NULL as rollout_path";

      threads = queryAll(db, `
        SELECT
          id,
          COALESCE(model, 'unknown') as model,
          COALESCE(cwd, '(unknown)') as project,
          ${rolloutPathColumn},
          tokens_used,
          updated_at_ms
        FROM threads
        WHERE tokens_used > 0 OR updated_at_ms IS NOT NULL
        ORDER BY updated_at_ms
      `) as any[];
    } finally {
      close();
    }

    const needle = modelFilter?.toLowerCase();

    const dailyMap = new Map<string, { tokens: number; sessions: number }>();
    const modelMap = new Map<string, { tokens: number; input: number; output: number; cache: number; count: number }>();
    const projectMap = new Map<string, number>();
    const hourlyMap = new Map<number, { tokens: number; sessions: number }>();
    let totalTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCache = 0;
    let totalSessions = 0;
    let rolloutFiles: string[] | null = null;
    let rolloutIndex: Map<string, string> | null = null;
    const findByThreadId = (threadId: string): string | null => {
      rolloutFiles ??= collectJsonlFiles(sessDir);
      rolloutIndex ??= buildRolloutIndex(rolloutFiles);
      return rolloutIndex.get(threadId) ?? findRolloutForThread(rolloutFiles, threadId);
    };

    // The per-thread input/output/cache split lives only in the rollout JSONL
    // files and is surfaced only by `--json`. The default heatmap+stats run and
    // `--by model` need just the per-thread token total, which the DB already
    // stores as `tokens_used` (model/project/time are on the thread row too), so
    // they read zero rollout files. Only `--json` resolves and parses rollouts.
    const needSplit = options.json === true;

    for (const thread of threads) {
      if (!thread.updated_at_ms) continue;

      const threadModel = (thread.model || "unknown").toLowerCase();
      if (needle && !threadModel.includes(needle)) continue;

      let tokens = thread.tokens_used || 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheTokens = 0;

      if (needSplit) {
        const rolloutPath = resolveRolloutPath(sessDir, thread, findByThreadId);
        const usage = rolloutPath ? readRolloutUsage(rolloutPath) : null;
        if (usage && usage.totalTokens > 0) {
          tokens = usage.totalTokens;
          inputTokens = usage.inputTokens;
          outputTokens = usage.outputTokens;
          cacheTokens = usage.cachedTokens;
        }
      }

      if (tokens === 0) continue;
      totalTokens += tokens;
      totalInput += inputTokens;
      totalOutput += outputTokens;
      totalCache += cacheTokens;
      totalSessions++;

      const date = formatDateLocal(new Date(thread.updated_at_ms));
      const d = dailyMap.get(date) || { tokens: 0, sessions: 0 };
      d.tokens += tokens;
      d.sessions += 1;
      dailyMap.set(date, d);

      const model = thread.model || "unknown";
      const mv = modelMap.get(model) || { tokens: 0, input: 0, output: 0, cache: 0, count: 0 };
      mv.tokens += tokens;
      mv.input += inputTokens;
      mv.output += outputTokens;
      mv.cache += cacheTokens;
      mv.count += 1;
      modelMap.set(model, mv);

      const project = thread.project === "/" ? "(global)" : thread.project;
      projectMap.set(project, (projectMap.get(project) || 0) + tokens);

      const hour = new Date(thread.updated_at_ms).getHours();
      const hv = hourlyMap.get(hour) || { tokens: 0, sessions: 0 };
      hv.tokens += tokens;
      hv.sessions += 1;
      hourlyMap.set(hour, hv);
    }

    const dailyActivity: DailyActivity[] = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, tokens: v.tokens, turns: v.sessions, cost: 0 }));

    const modelActivity: ModelActivity[] = Array.from(modelMap.entries())
      .sort(([, a], [, b]) => b.tokens - a.tokens)
      .map(([model, v]) => ({
        model,
        harness: "codex" as const,
        tokens: v.tokens,
        inputTokens: v.input,
        outputTokens: v.output,
        cacheTokens: v.cache,
        cost: 0,
      }));

    const projectActivity: ProjectActivity[] = Array.from(projectMap.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([project, tokens]) => ({ project, harness: "codex" as const, tokens }));

    const hourlyActivity: HourlyActivity[] = Array.from(hourlyMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([hour, v]) => ({ hour, tokens: v.tokens, turns: v.sessions }));

    const activeDays = dailyActivity.length;
    const bestDay = dailyActivity.reduce(
      (best, d) => (d.tokens > best.tokens ? d : best),
      { date: "", tokens: 0 }
    );

    if (totalTokens === 0) {
      const fallback = parseSessionRollouts(sessDir, modelFilter, paths.sourcePath);
      if (fallback) return fallback;
    }

    if (needle && totalTokens === 0) {
      return null;
    }

    return {
      harness: "codex",
      sourcePath: paths.sourcePath,
      totalTokens,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheTokens: totalCache,
      totalCost: 0,
      totalTurns: totalSessions,
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
    return parseSessionRollouts(sessDir, modelFilter, paths.sourcePath);
  }
}

function resolveCodexPaths(dataPath?: string, sessionsDir?: string): CodexPaths {
  if (!dataPath) {
    return {
      dbFile: DEFAULT_DB_PATH,
      sessionsDir: sessionsDir || DEFAULT_SESSIONS_DIR,
      sourcePath: DEFAULT_DB_PATH,
    };
  }

  try {
    if (fs.statSync(dataPath).isDirectory()) {
      const isSessionsDir = path.basename(dataPath) === "sessions";
      return {
        dbFile: isSessionsDir ? path.join(path.dirname(dataPath), "state_5.sqlite") : path.join(dataPath, "state_5.sqlite"),
        sessionsDir: sessionsDir || (isSessionsDir ? dataPath : path.join(dataPath, "sessions")),
        sourcePath: dataPath,
      };
    }
  } catch {}

  return {
    dbFile: dataPath,
    sessionsDir: sessionsDir || DEFAULT_SESSIONS_DIR,
    sourcePath: dataPath,
  };
}

function parseSessionRollouts(sessionsDir: string, modelFilter?: string, sourcePath = sessionsDir): AgentStats | null {
  const files = collectJsonlFiles(sessionsDir);
  if (files.length === 0) return null;

  const needle = modelFilter?.toLowerCase();
  const dailyMap = new Map<string, { tokens: number; sessions: number }>();
  const modelMap = new Map<string, { tokens: number; input: number; output: number; cache: number }>();
  const projectMap = new Map<string, number>();
  const hourlyMap = new Map<number, { tokens: number; sessions: number }>();

  let totalTokens = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCache = 0;
  let totalSessions = 0;

  for (const file of files) {
    const rollout = readRolloutSummary(file);
    if (!rollout || rollout.usage.totalTokens === 0) continue;
    if (needle && !rollout.model.toLowerCase().includes(needle)) continue;

    const timestamp = rollout.timestamp ? new Date(rollout.timestamp) : fs.statSync(file).mtime;
    const date = formatDateLocal(timestamp);
    const hour = timestamp.getHours();
    const model = rollout.model;
    const project = rollout.project === "/" ? "(global)" : rollout.project;
    const usage = rollout.usage;

    const daily = dailyMap.get(date) || { tokens: 0, sessions: 0 };
    daily.tokens += usage.totalTokens;
    daily.sessions += 1;
    dailyMap.set(date, daily);

    const modelEntry = modelMap.get(model) || { tokens: 0, input: 0, output: 0, cache: 0 };
    modelEntry.tokens += usage.totalTokens;
    modelEntry.input += usage.inputTokens;
    modelEntry.output += usage.outputTokens;
    modelEntry.cache += usage.cachedTokens;
    modelMap.set(model, modelEntry);

    projectMap.set(project, (projectMap.get(project) || 0) + usage.totalTokens);

    const hourly = hourlyMap.get(hour) || { tokens: 0, sessions: 0 };
    hourly.tokens += usage.totalTokens;
    hourly.sessions += 1;
    hourlyMap.set(hour, hourly);

    totalTokens += usage.totalTokens;
    totalInput += usage.inputTokens;
    totalOutput += usage.outputTokens;
    totalCache += usage.cachedTokens;
    totalSessions += 1;
  }

  if (totalTokens === 0) return null;

  const dailyActivity: DailyActivity[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, tokens: v.tokens, turns: v.sessions, cost: 0 }));

  const modelActivity: ModelActivity[] = Array.from(modelMap.entries())
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .map(([model, v]) => ({
      model,
      harness: "codex" as const,
      tokens: v.tokens,
      inputTokens: v.input,
      outputTokens: v.output,
      cacheTokens: v.cache,
      cost: 0,
    }));

  const projectActivity: ProjectActivity[] = Array.from(projectMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([project, tokens]) => ({ project, harness: "codex" as const, tokens }));

  const hourlyActivity: HourlyActivity[] = Array.from(hourlyMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([hour, v]) => ({ hour, tokens: v.tokens, turns: v.sessions }));

  const bestDay = dailyActivity.reduce(
    (best, d) => (d.tokens > best.tokens ? d : best),
    { date: "", tokens: 0 }
  );

  return {
    harness: "codex",
    sourcePath,
    totalTokens,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheTokens: totalCache,
    totalCost: 0,
    totalTurns: totalSessions,
    totalSessions,
    activeDays: dailyActivity.length,
    currentStreak: 0,
    longestStreak: 0,
    bestDay,
    dailyActivity,
    modelActivity,
    projectActivity,
    hourlyActivity,
  };
}

function readRolloutSummary(filePath: string): RolloutSummary | null {
  let lines: string[];
  try {
    lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  } catch {
    return null;
  }

  let usage: RolloutTokens | null = null;
  let completedUsage: RolloutTokens | null = null;
  let timestamp: string | null = null;
  let model = "unknown";
  let project = "(unknown)";

  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof obj.timestamp === "string") timestamp = obj.timestamp;

    const payload = obj.payload || {};
    if (typeof obj.cwd === "string") project = obj.cwd;
    if (typeof payload.cwd === "string") project = payload.cwd;
    if (typeof obj.model === "string") model = obj.model;
    if (typeof payload.model === "string") model = payload.model;
    if (typeof payload.info?.model === "string") model = payload.info.model;

    const cumulativeUsage = usageFromTokenCountEvent(obj);
    if (cumulativeUsage && cumulativeUsage.totalTokens > 0) usage = cumulativeUsage;

    const turnUsage = usageFromTurnCompletedEvent(obj);
    if (turnUsage && turnUsage.totalTokens > 0) {
      completedUsage = completedUsage ? addRolloutTokens(completedUsage, turnUsage) : turnUsage;
    }
  }

  return usage || completedUsage ? { usage: usage || completedUsage!, timestamp, model, project } : null;
}

function readRolloutUsage(filePath: string): RolloutTokens | null {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    let usage: RolloutTokens | null = null;
    let completedUsage: RolloutTokens | null = null;

    for (const line of lines) {
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      const cumulativeUsage = usageFromTokenCountEvent(obj);
      if (cumulativeUsage && cumulativeUsage.totalTokens > 0) usage = cumulativeUsage;

      const turnUsage = usageFromTurnCompletedEvent(obj);
      if (turnUsage && turnUsage.totalTokens > 0) {
        completedUsage = completedUsage ? addRolloutTokens(completedUsage, turnUsage) : turnUsage;
      }
    }

    return usage || completedUsage;
  } catch {
    return null;
  }
}

function usageFromTokenCountEvent(obj: any): RolloutTokens | null {
  if (
    obj.type === "event_msg" &&
    obj.payload?.type === "token_count" &&
    obj.payload?.info?.total_token_usage
  ) {
    const parsedUsage = tokenUsageFromRaw(obj.payload.info.total_token_usage);
    return parsedUsage.totalTokens > 0 ? parsedUsage : null;
  }

  return null;
}

function usageFromTurnCompletedEvent(obj: any): RolloutTokens | null {
  if (obj.type === "turn.completed" && obj.usage) {
    const parsedUsage = tokenUsageFromRaw(obj.usage);
    return parsedUsage.totalTokens > 0 ? parsedUsage : null;
  }

  return null;
}

function addRolloutTokens(a: RolloutTokens, b: RolloutTokens): RolloutTokens {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function numericToken(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

function tokenCount(value: unknown): number {
  return numericToken(value) || 0;
}

function tokenUsageFromRaw(u: any): RolloutTokens {
  const inputTokens = tokenCount(u.input_tokens);
  const outputTokens = tokenCount(u.output_tokens);
  const cachedTokens = tokenCount(u.cached_input_tokens);
  const reasoningTokens = tokenCount(u.reasoning_output_tokens);
  const totalTokens = numericToken(u.total_tokens) ?? inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    totalTokens,
  };
}
