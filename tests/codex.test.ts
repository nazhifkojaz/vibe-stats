import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "../src/sources/codex";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function writeCodexSessionsFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-codex-"));
  tempDirs.push(root);

  const sessionDir = path.join(root, "sessions", "2026", "06", "01");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path.join(sessionDir, "rollout-thread-1.jsonl"), [
    JSON.stringify({
      timestamp: "2026-06-01T10:00:00",
      type: "session_meta",
      payload: {
        cwd: "/home/alice/secret-app",
        model: "gpt-5",
      },
    }),
    "not json",
    JSON.stringify({
      timestamp: "2026-06-01T10:03:00",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 40,
            cached_input_tokens: 10,
            output_tokens: 10,
            reasoning_output_tokens: 5,
            total_tokens: 50,
          },
        },
      },
    }),
    JSON.stringify({
      timestamp: "2026-06-01T10:05:00",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 50,
            reasoning_output_tokens: 30,
            total_tokens: 150,
          },
        },
      },
    }),
  ].join("\n"));

  return root;
}

function writeCodexExecJsonlFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-codex-exec-"));
  tempDirs.push(root);

  const sessionDir = path.join(root, "sessions", "2026", "06", "02");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path.join(sessionDir, "rollout-exec.jsonl"), [
    JSON.stringify({
      timestamp: "2026-06-02T08:00:00",
      type: "session_meta",
      payload: {
        cwd: "/home/alice/exec-app",
        model: "gpt-5-mini",
      },
    }),
    JSON.stringify({
      timestamp: "2026-06-02T08:04:00",
      type: "turn.completed",
      usage: {
        input_tokens: 40,
        cached_input_tokens: 30,
        output_tokens: 10,
        reasoning_output_tokens: 5,
      },
    }),
  ].join("\n"));

  return root;
}

async function writeCodexDbWithRolloutFixture(): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-codex-db-"));
  tempDirs.push(root);

  const sessionDir = path.join(root, "sessions", "2026", "06", "03");
  mkdirSync(sessionDir, { recursive: true });
  const rolloutPath = path.join(sessionDir, "rollout-thread-db.jsonl");
  writeFileSync(rolloutPath, [
    JSON.stringify({
      timestamp: "2026-06-03T10:00:00",
      type: "turn_context",
      payload: {
        cwd: "/home/alice/db-app",
        model: "gpt-5.5",
      },
    }),
    JSON.stringify({
      timestamp: "2026-06-03T10:05:00",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 80,
            output_tokens: 50,
            reasoning_output_tokens: 20,
            total_tokens: 150,
          },
        },
      },
    }),
  ].join("\n"));

  const dbPath = path.join(root, "state_5.sqlite");
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      model TEXT,
      cwd TEXT,
      rollout_path TEXT,
      tokens_used INTEGER DEFAULT 0,
      updated_at_ms INTEGER
    );
  `);
  db.run(
    "INSERT INTO threads (id, model, cwd, rollout_path, tokens_used, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
    ["thread-db", "gpt-5.5", "/home/alice/db-app", rolloutPath, 150, new Date(2026, 5, 3, 10, 5).getTime()]
  );
  db.run(
    "INSERT INTO threads (id, model, cwd, rollout_path, tokens_used, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
    ["thread-db-missing-rollout", "gpt-5.5", "/home/alice/db-app", "/missing/rollout.jsonl", 75, new Date(2026, 5, 3, 11, 0).getTime()]
  );
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  return root;
}

async function writeLegacyCodexDbFixture(): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-codex-legacy-db-"));
  tempDirs.push(root);

  const sessionDir = path.join(root, "sessions", "2026", "06", "04");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path.join(sessionDir, "rollout-thread-legacy.jsonl"), [
    JSON.stringify({
      timestamp: "2026-06-04T12:00:00",
      type: "turn_context",
      payload: {
        cwd: "/home/alice/legacy-app",
        model: "gpt-5-legacy",
      },
    }),
    JSON.stringify({
      timestamp: "2026-06-04T12:06:00",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 70,
            cached_input_tokens: 60,
            output_tokens: 20,
            reasoning_output_tokens: 10,
            total_tokens: 90,
          },
        },
      },
    }),
  ].join("\n"));

  const dbPath = path.join(root, "state_5.sqlite");
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      model TEXT,
      cwd TEXT,
      tokens_used INTEGER DEFAULT 0,
      updated_at_ms INTEGER
    );
  `);
  db.run(
    "INSERT INTO threads (id, model, cwd, tokens_used, updated_at_ms) VALUES (?, ?, ?, ?, ?)",
    ["thread-legacy", "gpt-5-legacy", "/home/alice/legacy-app", 90, new Date(2026, 5, 4, 12, 6).getTime()]
  );
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  return root;
}

describe("codex.parse", () => {
  it("falls back to Codex session JSONL logs without double-counting detail token fields", async () => {
    const root = writeCodexSessionsFixture();
    const stats = await parse(root);

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      harness: "codex",
      sourcePath: root,
      totalTokens: 150,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheTokens: 20,
      totalCost: 0,
      totalTurns: 1,
      totalSessions: 1,
      activeDays: 1,
      bestDay: { date: "2026-06-01", tokens: 150, turns: 1, cost: 0 },
      dailyActivity: [
        { date: "2026-06-01", tokens: 150, turns: 1, cost: 0 },
      ],
      modelActivity: [
        { model: "gpt-5", harness: "codex", tokens: 150, inputTokens: 100, outputTokens: 50, cacheTokens: 20, cost: 0 },
      ],
      projectActivity: [
        { project: "/home/alice/secret-app", harness: "codex", tokens: 150 },
      ],
      hourlyActivity: [
        { hour: 10, tokens: 150, turns: 1 },
      ],
    });
  });

  it("accepts the Codex sessions directory directly", async () => {
    const root = writeCodexSessionsFixture();
    const sessionsDir = path.join(root, "sessions");
    const stats = await parse(sessionsDir);

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      sourcePath: sessionsDir,
      totalTokens: 150,
      totalTurns: 1,
      totalSessions: 1,
    });
  });

  it("filters Codex session JSONL logs by model", async () => {
    const stats = await parse(writeCodexSessionsFixture(), undefined, "gpt-5");

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 150,
      modelActivity: [
        { model: "gpt-5", harness: "codex", tokens: 150, inputTokens: 100, outputTokens: 50, cacheTokens: 20, cost: 0 },
      ],
    });
    expect(await parse(writeCodexSessionsFixture(), undefined, "claude")).toBeNull();
  });

  it("parses codex exec JSONL turn.completed usage when token_count events are absent", async () => {
    const stats = await parse(writeCodexExecJsonlFixture());

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 50,
      totalInputTokens: 40,
      totalOutputTokens: 10,
      totalCacheTokens: 30,
      dailyActivity: [
        { date: "2026-06-02", tokens: 50, turns: 1, cost: 0 },
      ],
      modelActivity: [
        { model: "gpt-5-mini", harness: "codex", tokens: 50, inputTokens: 40, outputTokens: 10, cacheTokens: 30, cost: 0 },
      ],
      projectActivity: [
        { project: "/home/alice/exec-app", harness: "codex", tokens: 50 },
      ],
    });
  });

  it("uses DB tokens_used for totals and reads no rollout files in default mode", async () => {
    const root = await writeCodexDbWithRolloutFixture();
    const readSpy = vi.spyOn(fs, "readFileSync");
    const stats = await parse(root);
    const readCalls = readSpy.mock.calls.length;
    readSpy.mockRestore();

    expect(stats).not.toBeNull();
    // Totals come straight from the DB `tokens_used` counter (150 + 75); the
    // heatmap/stats numbers are identical to --json because tokens_used matches
    // the rollout's total here.
    expect(stats).toMatchObject({
      sourcePath: root,
      totalTokens: 225,
      totalTurns: 2,
      totalSessions: 2,
      dailyActivity: [
        { date: "2026-06-03", tokens: 225, turns: 2, cost: 0 },
      ],
      projectActivity: [
        { project: "/home/alice/db-app", harness: "codex", tokens: 225 },
      ],
      hourlyActivity: [
        { hour: 10, tokens: 150, turns: 1 },
        { hour: 11, tokens: 75, turns: 1 },
      ],
    });
    // The input/output/cache split is only read from rollouts under --json, so
    // default mode leaves it zero and never opens a rollout file.
    expect(stats).toMatchObject({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheTokens: 0,
      modelActivity: [
        { model: "gpt-5.5", harness: "codex", tokens: 225, inputTokens: 0, outputTokens: 0, cacheTokens: 0, cost: 0 },
      ],
    });
    expect(readCalls).toBe(0);
  });

  it("reads rollouts for the input/output/cache split when --json is requested", async () => {
    const root = await writeCodexDbWithRolloutFixture();
    const readSpy = vi.spyOn(fs, "readFileSync");
    const stats = await parse(root, undefined, undefined, { json: true });
    const readCalls = readSpy.mock.calls.length;
    readSpy.mockRestore();

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      sourcePath: root,
      totalTokens: 225,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheTokens: 80,
      totalTurns: 2,
      totalSessions: 2,
      dailyActivity: [
        { date: "2026-06-03", tokens: 225, turns: 2, cost: 0 },
      ],
      modelActivity: [
        { model: "gpt-5.5", harness: "codex", tokens: 225, inputTokens: 100, outputTokens: 50, cacheTokens: 80, cost: 0 },
      ],
      projectActivity: [
        { project: "/home/alice/db-app", harness: "codex", tokens: 225 },
      ],
      hourlyActivity: [
        { hour: 10, tokens: 150, turns: 1 },
        { hour: 11, tokens: 75, turns: 1 },
      ],
    });
    // --json resolves and parses the rollout JSONL to recover the split.
    expect(readCalls).toBeGreaterThan(0);
  });

  it("scans session filenames to resolve the split for older state DBs without rollout_path under --json", async () => {
    const stats = await parse(await writeLegacyCodexDbFixture(), undefined, undefined, { json: true });

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 90,
      totalInputTokens: 70,
      totalOutputTokens: 20,
      totalCacheTokens: 60,
      modelActivity: [
        { model: "gpt-5-legacy", harness: "codex", tokens: 90, inputTokens: 70, outputTokens: 20, cacheTokens: 60, cost: 0 },
      ],
      projectActivity: [
        { project: "/home/alice/legacy-app", harness: "codex", tokens: 90 },
      ],
    });
  });
});
