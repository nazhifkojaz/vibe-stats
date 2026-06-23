import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "../src/sources/opencode";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

async function createTestDb(setup: (db: any) => void): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-opencode-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "opencode.db");

  const SQL = await initSqlJs();
  const db = new SQL.Database();
  setup(db);
  const data = db.export();
  db.close();

  mkdirSync(path.dirname(dbPath), { recursive: true });
  writeFileSync(dbPath, Buffer.from(data));
  return dbPath;
}

async function writeMessageOnlyOpenCodeDb(): Promise<string> {
  return createTestDb((db) => {
    db.run(`
      CREATE TABLE message (
        time_created INTEGER NOT NULL,
        session_id TEXT,
        data TEXT NOT NULL
      );
    `);

    db.run(
      "INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)",
      [
        new Date(2026, 5, 1, 10, 15).getTime(),
        "session-1",
        JSON.stringify({
          role: "assistant",
          modelID: "gpt-5",
          cost: 0.12,
          tokens: {
            input: 100,
            output: 50,
            reasoning: 25,
            cache: { read: 20, write: 5 },
          },
        }),
      ]
    );
    db.run(
      "INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)",
      [
        new Date(2026, 5, 1, 11, 30).getTime(),
        "session-1",
        JSON.stringify({
          role: "assistant",
          modelID: "claude-sonnet",
          cost: 0.05,
          tokens: {
            input: 40,
            output: 10,
            cache: { read: 0, write: 0 },
          },
        }),
      ]
    );
    db.run(
      "INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)",
      [
        new Date(2026, 5, 1, 12, 0).getTime(),
        "session-1",
        JSON.stringify({ role: "user", tokens: { input: 999 } }),
      ]
    );
  });
}

async function writeSessionOnlyOpenCodeDb(): Promise<string> {
  return createTestDb((db) => {
    db.run(`
      CREATE TABLE session (
        time_created INTEGER NOT NULL,
        directory TEXT,
        tokens_input INTEGER DEFAULT 0,
        tokens_output INTEGER DEFAULT 0,
        tokens_reasoning INTEGER DEFAULT 0,
        tokens_cache_read INTEGER DEFAULT 0,
        tokens_cache_write INTEGER DEFAULT 0,
        cost REAL DEFAULT 0
      );
    `);

    db.run(
      "INSERT INTO session (time_created, directory, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [new Date(2026, 5, 1, 10, 0).getTime(), "/home/alice/app", 200, 100, 50, 30, 10, 0.15]
    );
    db.run(
      "INSERT INTO session (time_created, directory, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [new Date(2026, 5, 2, 14, 0).getTime(), "/home/alice/app", 500, 200, 0, 0, 0, 0.25]
    );
    db.run(
      "INSERT INTO session (time_created, directory, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [new Date(2026, 5, 2, 16, 0).getTime(), "/home/bob/other", 100, 50, 0, 0, 0, 0]
    );
  });
}

async function writePartialColumnsDb(): Promise<string> {
  return createTestDb((db) => {
    db.run(`
      CREATE TABLE session (
        time_created INTEGER NOT NULL,
        directory TEXT,
        tokens_input INTEGER DEFAULT 0,
        tokens_output INTEGER DEFAULT 0,
        cost REAL DEFAULT 0
      );
    `);

    db.run(
      "INSERT INTO session (time_created, directory, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?)",
      [new Date(2026, 5, 1, 10, 0).getTime(), "/home/alice/app", 300, 150, 0.1]
    );
  });
}

async function writeEmptyDb(): Promise<string> {
  return createTestDb((db) => {
    db.run("CREATE TABLE irrelevant (id INTEGER)");
  });
}

describe("opencode.parse", () => {
  it("falls back to assistant message token rows when session aggregates are unavailable", async () => {
    const stats = await parse(await writeMessageOnlyOpenCodeDb());

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      harness: "opencode",
      totalTokens: 250,
      totalInputTokens: 140,
      totalOutputTokens: 60,
      totalCacheTokens: 25,
      totalTurns: 2,
      totalSessions: 1,
      activeDays: 1,
      bestDay: { date: "2026-06-01", tokens: 250, turns: 2, cost: 0.16999999999999998 },
      dailyActivity: [
        { date: "2026-06-01", tokens: 250, turns: 2, cost: 0.16999999999999998 },
      ],
      hourlyActivity: [
        { hour: 10, tokens: 200, turns: 1 },
        { hour: 11, tokens: 50, turns: 1 },
      ],
    });
    expect(stats!.totalCost).toBeCloseTo(0.17);
    expect(stats!.modelActivity).toEqual(expect.arrayContaining([
      {
        model: "gpt-5",
        harness: "opencode",
        tokens: 200,
        inputTokens: 100,
        outputTokens: 50,
        cacheTokens: 25,
        cost: 0.12,
      },
      {
        model: "claude-sonnet",
        harness: "opencode",
        tokens: 50,
        inputTokens: 40,
        outputTokens: 10,
        cacheTokens: 0,
        cost: 0.05,
      },
    ]));
  });

  it("filters OpenCode message fallback rows by model", async () => {
    const stats = await parse(await writeMessageOnlyOpenCodeDb(), "gpt");

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 200,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheTokens: 25,
      totalTurns: 1,
      totalSessions: 1,
      dailyActivity: [
        { date: "2026-06-01", tokens: 200, turns: 1, cost: 0.12 },
      ],
    });
    expect(stats!.modelActivity).toHaveLength(1);
    expect(stats!.modelActivity[0].model).toBe("gpt-5");
  });

  it("reads session table aggregates when available", async () => {
    const stats = await parse(await writeSessionOnlyOpenCodeDb());

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      harness: "opencode",
      totalTokens: 1240,
      totalInputTokens: 800,
      totalOutputTokens: 350,
      totalCacheTokens: 40,
      totalCost: 0.4,
      totalTurns: 3,
      totalSessions: 3,
      activeDays: 2,
    });
    expect(stats!.dailyActivity).toHaveLength(2);
    expect(stats!.dailyActivity[0]).toMatchObject({ date: "2026-06-01", tokens: 390 });
    expect(stats!.dailyActivity[1]).toMatchObject({ date: "2026-06-02", tokens: 850 });
    expect(stats!.projectActivity).toEqual(expect.arrayContaining([
      { project: "/home/alice/app", harness: "opencode", tokens: 1090 },
      { project: "/home/bob/other", harness: "opencode", tokens: 150 },
    ]));
    expect(stats!.modelActivity).toEqual([]);
  });

  it("handles session table with partial token columns (no reasoning, no cache)", async () => {
    const stats = await parse(await writePartialColumnsDb());

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      harness: "opencode",
      totalTokens: 450,
      totalInputTokens: 300,
      totalOutputTokens: 150,
      totalCacheTokens: 0,
      totalCost: 0.1,
      activeDays: 1,
    });
    expect(stats!.dailyActivity).toHaveLength(1);
    expect(stats!.dailyActivity[0].tokens).toBe(450);
  });

  it("returns zero-token stats when DB has no recognized tables", async () => {
    const stats = await parse(await writeEmptyDb());

    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(0);
    expect(stats!.dailyActivity).toEqual([]);
  });

  it("returns null for nonexistent file path", async () => {
    const stats = await parse("/nonexistent/path/opencode.db");

    expect(stats).toBeNull();
  });

  it("returns null when model filter matches nothing in messages", async () => {
    const stats = await parse(await writeMessageOnlyOpenCodeDb(), "nonexistent-model");

    expect(stats).toBeNull();
  });

  it("handles parent-child sessions (subagents)", async () => {
    const dbPath = await createTestDb((db) => {
      db.run(`
        CREATE TABLE session (
          id TEXT PRIMARY KEY,
          parent_id TEXT,
          time_created INTEGER NOT NULL,
          directory TEXT,
          tokens_input INTEGER DEFAULT 0,
          tokens_output INTEGER DEFAULT 0,
          tokens_reasoning INTEGER DEFAULT 0,
          tokens_cache_read INTEGER DEFAULT 0,
          tokens_cache_write INTEGER DEFAULT 0,
          cost REAL DEFAULT 0
        );
      `);

      db.run(
        "INSERT INTO session (id, parent_id, time_created, directory, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["parent-1", null, new Date(2026, 5, 1, 10, 0).getTime(), "/home/alice/app", 100, 50, 25, 10, 5, 0.1]
      );
      db.run(
        "INSERT INTO session (id, parent_id, time_created, directory, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["child-1", "parent-1", new Date(2026, 5, 1, 10, 5).getTime(), "/home/alice/app", 200, 100, 50, 20, 10, 0.2]
      );
      db.run(
        "INSERT INTO session (id, parent_id, time_created, directory, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["child-2", "parent-1", new Date(2026, 5, 1, 10, 10).getTime(), "/home/alice/app", 150, 75, 30, 15, 8, 0.15]
      );
    });

    const stats = await parse(dbPath);

    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(848);
    expect(stats!.totalInputTokens).toBe(450);
    expect(stats!.totalOutputTokens).toBe(225);
    expect(stats!.totalSessions).toBe(3);
    expect(stats!.activeDays).toBe(1);
  });

  async function writeSessionAndMessageDb(): Promise<string> {
    return createTestDb((db) => {
      db.run(`
        CREATE TABLE session (
          time_created INTEGER NOT NULL,
          directory TEXT,
          tokens_input INTEGER DEFAULT 0,
          tokens_output INTEGER DEFAULT 0,
          cost REAL DEFAULT 0
        );
      `);
      db.run(`
        CREATE TABLE message (
          time_created INTEGER NOT NULL,
          session_id TEXT,
          data TEXT NOT NULL
        );
      `);

      db.run(
        "INSERT INTO session (time_created, directory, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?)",
        [new Date(2026, 5, 1, 10, 0).getTime(), "/home/alice/app", 500, 200, 0.3]
      );

      db.run(
        "INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)",
        [
          new Date(2026, 5, 1, 10, 15).getTime(),
          "session-1",
          JSON.stringify({
            role: "assistant",
            modelID: "gpt-5",
            cost: 0.12,
            tokens: { input: 100, output: 50, reasoning: 25, cache: { read: 20, write: 5 } },
          }),
        ]
      );
    });
  }

  it("uses session table (and skips the message scan) in default mode", async () => {
    const stats = await parse(await writeSessionAndMessageDb());

    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(700);
    expect(stats!.totalInputTokens).toBe(500);
    expect(stats!.totalOutputTokens).toBe(200);
    // The default heatmap+stats run never renders modelActivity, so the message
    // table is not scanned and the per-model breakdown stays empty.
    expect(stats!.modelActivity).toEqual([]);
  });

  it("scans messages for the per-model breakdown only when --by model is requested", async () => {
    const stats = await parse(await writeSessionAndMessageDb(), undefined, { by: "model" });

    expect(stats).not.toBeNull();
    // Totals still come from the session table...
    expect(stats!.totalTokens).toBe(700);
    expect(stats!.totalInputTokens).toBe(500);
    // ...but the model breakdown is now populated from the message scan.
    expect(stats!.modelActivity).toHaveLength(1);
    expect(stats!.modelActivity[0]).toMatchObject({ model: "gpt-5", tokens: 200 });
  });

  it("scans messages for the input/output/cache split when --json is requested", async () => {
    const stats = await parse(await writeSessionAndMessageDb(), undefined, { json: true });

    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(700);
    expect(stats!.modelActivity).toHaveLength(1);
    expect(stats!.modelActivity[0]).toMatchObject({
      model: "gpt-5",
      tokens: 200,
      inputTokens: 100,
      outputTokens: 50,
      cacheTokens: 25,
    });
  });

  it("aggregates message rows across days, hours, models, and sessions in SQL", async () => {
    const dbPath = await createTestDb((db) => {
      db.run(`
        CREATE TABLE message (
          time_created INTEGER NOT NULL,
          session_id TEXT,
          data TEXT NOT NULL
        );
      `);

      const insert = (time: number, session: string, data: object) =>
        db.run("INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)", [
          time,
          session,
          JSON.stringify(data),
        ]);

      // Two rows that share date/hour/model/session collapse into one group.
      insert(new Date(2026, 5, 1, 10, 5).getTime(), "session-a", {
        role: "assistant",
        modelID: "gpt-5",
        cost: 0.1,
        tokens: { input: 100, output: 50 },
      });
      insert(new Date(2026, 5, 1, 10, 40).getTime(), "session-a", {
        role: "assistant",
        modelID: "gpt-5",
        cost: 0.05,
        tokens: { input: 10, output: 5 },
      });
      // A different day, hour, model, and session.
      insert(new Date(2026, 5, 2, 14, 0).getTime(), "session-b", {
        role: "assistant",
        modelID: "claude-sonnet",
        cost: 0.2,
        tokens: { input: 200, output: 100 },
      });
    });

    const stats = await parse(dbPath);

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 465,
      totalInputTokens: 310,
      totalOutputTokens: 155,
      totalCacheTokens: 0,
      totalTurns: 3,
      totalSessions: 2,
      activeDays: 2,
      dailyActivity: [
        { date: "2026-06-01", tokens: 165, turns: 2 },
        { date: "2026-06-02", tokens: 300, turns: 1 },
      ],
      hourlyActivity: [
        { hour: 10, tokens: 165, turns: 2 },
        { hour: 14, tokens: 300, turns: 1 },
      ],
    });
    expect(stats!.totalCost).toBeCloseTo(0.35);
    expect(stats!.modelActivity).toEqual(expect.arrayContaining([
      { model: "gpt-5", harness: "opencode", tokens: 165, inputTokens: 110, outputTokens: 55, cacheTokens: 0, cost: expect.closeTo(0.15) },
      { model: "claude-sonnet", harness: "opencode", tokens: 300, inputTokens: 200, outputTokens: 100, cacheTokens: 0, cost: 0.2 },
    ]));
  });

  it("excludes assistant rows with no resolvable timestamp from both tokens and session count", async () => {
    const dbPath = await createTestDb((db) => {
      // time_created is nullable here so we can store a row with no timestamp at all.
      db.run(`
        CREATE TABLE message (
          time_created INTEGER,
          session_id TEXT,
          data TEXT NOT NULL
        );
      `);

      db.run(
        "INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)",
        [
          new Date(2026, 5, 1, 10, 0).getTime(),
          "session-timed",
          JSON.stringify({ role: "assistant", modelID: "gpt-5", tokens: { input: 100, output: 50 } }),
        ]
      );
      // No time_created value AND no $.time.created → unresolvable timestamp. The old
      // JS reader dated this to "today"; the SQL path drops it deterministically, and
      // must drop it from the session count too (else totalSessions would disagree
      // with the token totals).
      db.run(
        "INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)",
        [
          null,
          "session-untimed",
          JSON.stringify({ role: "assistant", modelID: "gpt-5", tokens: { input: 9999, output: 9999 } }),
        ]
      );
    });

    const stats = await parse(dbPath);

    expect(stats).not.toBeNull();
    // Only the timed row contributes tokens/turns...
    expect(stats!.totalTokens).toBe(150);
    expect(stats!.totalTurns).toBe(1);
    // ...and only its session is counted (session-untimed is excluded, so totalSessions
    // stays consistent with the token totals).
    expect(stats!.totalSessions).toBe(1);
    expect(stats!.dailyActivity).toEqual([
      { date: "2026-06-01", tokens: 150, turns: 1, cost: 0 },
    ]);
  });

  it("correctly identifies bestDay across multiple days", async () => {
    const dbPath = await createTestDb((db) => {
      db.run(`
        CREATE TABLE session (
          time_created INTEGER NOT NULL,
          directory TEXT,
          tokens_input INTEGER DEFAULT 0,
          tokens_output INTEGER DEFAULT 0,
          cost REAL DEFAULT 0
        );
      `);

      db.run(
        "INSERT INTO session (time_created, directory, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?)",
        [new Date(2026, 5, 1, 10, 0).getTime(), "/home/alice/app", 100, 50, 0.1]
      );
      db.run(
        "INSERT INTO session (time_created, directory, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?)",
        [new Date(2026, 5, 2, 14, 0).getTime(), "/home/alice/app", 300, 150, 0.2]
      );
      db.run(
        "INSERT INTO session (time_created, directory, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?)",
        [new Date(2026, 5, 3, 16, 0).getTime(), "/home/alice/app", 200, 100, 0.15]
      );
    });

    const stats = await parse(dbPath);

    expect(stats).not.toBeNull();
    expect(stats!.bestDay).toMatchObject({ date: "2026-06-02", tokens: 450 });
  });

  it("handles zero-token sessions", async () => {
    const dbPath = await createTestDb((db) => {
      db.run(`
        CREATE TABLE session (
          time_created INTEGER NOT NULL,
          directory TEXT,
          tokens_input INTEGER DEFAULT 0,
          tokens_output INTEGER DEFAULT 0,
          cost REAL DEFAULT 0
        );
      `);

      db.run(
        "INSERT INTO session (time_created, directory, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?)",
        [new Date(2026, 5, 1, 10, 0).getTime(), "/home/alice/app", 100, 50, 0.1]
      );
      db.run(
        "INSERT INTO session (time_created, directory, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?)",
        [new Date(2026, 5, 2, 14, 0).getTime(), "/home/alice/app", 0, 0, 0]
      );
    });

    const stats = await parse(dbPath);

    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(150);
    expect(stats!.totalSessions).toBe(2);
    expect(stats!.activeDays).toBe(1);
    expect(stats!.dailyActivity).toHaveLength(1);
  });

  it("handles messages with missing cache object", async () => {
    const dbPath = await createTestDb((db) => {
      db.run(`
        CREATE TABLE message (
          time_created INTEGER NOT NULL,
          session_id TEXT,
          data TEXT NOT NULL
        );
      `);

      db.run(
        "INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)",
        [
          new Date(2026, 5, 1, 10, 15).getTime(),
          "session-1",
          JSON.stringify({
            role: "assistant",
            modelID: "gpt-5",
            cost: 0.12,
            tokens: { input: 100, output: 50, reasoning: 25 },
          }),
        ]
      );
    });

    const stats = await parse(dbPath);

    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(175);
    expect(stats!.totalCacheTokens).toBe(0);
  });

  it("handles messages with partial token fields (no output, no reasoning)", async () => {
    const dbPath = await createTestDb((db) => {
      db.run(`
        CREATE TABLE message (
          time_created INTEGER NOT NULL,
          session_id TEXT,
          data TEXT NOT NULL
        );
      `);

      db.run(
        "INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)",
        [
          new Date(2026, 5, 1, 10, 15).getTime(),
          "session-1",
          JSON.stringify({
            role: "assistant",
            modelID: "gpt-5",
            cost: 0.12,
            tokens: { input: 100, cache: { read: 50, write: 10 } },
          }),
        ]
      );
    });

    const stats = await parse(dbPath);

    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(160);
    expect(stats!.totalInputTokens).toBe(100);
    expect(stats!.totalOutputTokens).toBe(0);
    expect(stats!.totalCacheTokens).toBe(60);
  });

  it("prefers JSON time.created over time_created column", async () => {
    const dbPath = await createTestDb((db) => {
      db.run(`
        CREATE TABLE message (
          time_created INTEGER NOT NULL,
          session_id TEXT,
          data TEXT NOT NULL
        );
      `);

      const columnTime = new Date(2026, 5, 1, 10, 0).getTime();
      const jsonTime = new Date(2026, 5, 2, 14, 0).getTime();

      db.run(
        "INSERT INTO message (time_created, session_id, data) VALUES (?, ?, ?)",
        [
          columnTime,
          "session-1",
          JSON.stringify({
            role: "assistant",
            modelID: "gpt-5",
            cost: 0.12,
            time: { created: jsonTime },
            tokens: { input: 100, output: 50 },
          }),
        ]
      );
    });

    const stats = await parse(dbPath);

    expect(stats).not.toBeNull();
    expect(stats!.dailyActivity).toHaveLength(1);
    expect(stats!.dailyActivity[0].date).toBe("2026-06-02");
  });

  it("handles sessions with agent column (subagent types)", async () => {
    const dbPath = await createTestDb((db) => {
      db.run(`
        CREATE TABLE session (
          time_created INTEGER NOT NULL,
          directory TEXT,
          agent TEXT,
          tokens_input INTEGER DEFAULT 0,
          tokens_output INTEGER DEFAULT 0,
          cost REAL DEFAULT 0
        );
      `);

      db.run(
        "INSERT INTO session (time_created, directory, agent, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?, ?)",
        [new Date(2026, 5, 1, 10, 0).getTime(), "/home/alice/app", null, 100, 50, 0.1]
      );
      db.run(
        "INSERT INTO session (time_created, directory, agent, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?, ?)",
        [new Date(2026, 5, 1, 10, 5).getTime(), "/home/alice/app", "build", 200, 100, 0.2]
      );
      db.run(
        "INSERT INTO session (time_created, directory, agent, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?, ?)",
        [new Date(2026, 5, 1, 10, 10).getTime(), "/home/alice/app", "explore", 150, 75, 0.15]
      );
    });

    const stats = await parse(dbPath);

    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(675);
    expect(stats!.totalSessions).toBe(3);
    expect(stats!.activeDays).toBe(1);
  });
});
