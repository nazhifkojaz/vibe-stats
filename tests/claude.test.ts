import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "../src/sources/claude";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function writeClaudeFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "stats-cache.json");

  writeFileSync(filePath, JSON.stringify({
    version: 1,
    lastComputedDate: "2026-06-02",
    dailyActivity: [
      { date: "2026-05-31", messageCount: 2, sessionCount: 1, toolCallCount: 0 },
      { date: "2026-06-01", messageCount: 3, sessionCount: 1, toolCallCount: 0 },
    ],
    dailyModelTokens: [
      { date: "2026-05-31", tokensByModel: { "claude-sonnet": 100, "claude-opus": 300 } },
      { date: "2026-06-01", tokensByModel: { "claude-sonnet": 250, "claude-opus": 350 } },
    ],
    modelUsage: {
      "claude-sonnet": {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadInputTokens: 30,
        cacheCreationInputTokens: 20,
        costUSD: 1.23,
      },
      "claude-opus": {
        inputTokens: 400,
        outputTokens: 200,
        cacheReadInputTokens: 50,
        cacheCreationInputTokens: 0,
        costUSD: 2,
      },
    },
    totalSessions: 2,
    totalMessages: 5,
    hourCounts: { "9": 1, "10": 3 },
    firstSessionDate: "2026-05-31",
  }));

  return filePath;
}

function writeClaudeProjectsFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-projects-"));
  tempDirs.push(root);

  const projectDir = path.join(root, "projects", "-home-alice-secret-app");
  mkdirSync(projectDir, { recursive: true });
  const filePath = path.join(projectDir, "session.jsonl");

  writeFileSync(filePath, [
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-01T09:15:00",
      cwd: "/home/alice/secret-app",
      sessionId: "session-1",
      message: {
        role: "assistant",
        model: "claude-sonnet-4",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 10,
        },
      },
    }),
    "not json",
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-01T09:45:00",
      cwd: "/home/alice/secret-app",
      sessionId: "session-1",
      message: {
        role: "assistant",
        model: "claude-opus-4",
        usage: {
          input_tokens: 200,
          output_tokens: 100,
        },
      },
    }),
  ].join("\n"));

  return root;
}

function writeTopLevelUsageFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-top-"));
  tempDirs.push(root);

  const projectDir = path.join(root, "projects", "-home-alice-app");
  mkdirSync(projectDir, { recursive: true });
  const filePath = path.join(projectDir, "session.jsonl");

  writeFileSync(filePath, [
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-01T10:00:00",
      role: "assistant",
      model: "claude-sonnet-4",
      usage: {
        input_tokens: 500,
        output_tokens: 200,
        cache_read_input_tokens: 50,
      },
      sessionId: "session-top",
    }),
    JSON.stringify({
      type: "user",
      timestamp: "2026-06-01T09:59:00",
      role: "user",
      message: { role: "user", content: "hello" },
    }),
  ].join("\n"));

  return root;
}

function writeStaleCacheWithJsonlFixture(): { root: string; cacheDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-stale-"));
  tempDirs.push(root);

  const projectDir = path.join(root, "projects", "-home-alice-app");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, "session.jsonl"), [
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-01T10:00:00",
      cwd: "/home/alice/app",
      sessionId: "session-1",
      message: {
        role: "assistant",
        model: "claude-sonnet-4",
        usage: { input_tokens: 1000, output_tokens: 500 },
      },
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-02T10:00:00",
      cwd: "/home/alice/app",
      sessionId: "session-2",
      message: {
        role: "assistant",
        model: "claude-sonnet-4",
        usage: { input_tokens: 2000, output_tokens: 1000 },
      },
    }),
  ].join("\n"));

  writeFileSync(path.join(root, "stats-cache.json"), JSON.stringify({
    version: 1,
    lastComputedDate: "2026-06-01",
    dailyActivity: [
      { date: "2026-06-01", messageCount: 1, sessionCount: 1, toolCallCount: 0 },
    ],
    dailyModelTokens: [
      { date: "2026-06-01", tokensByModel: { "claude-sonnet-4": 300 } },
    ],
    modelUsage: {
      "claude-sonnet-4": {
        inputTokens: 200,
        outputTokens: 100,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0.5,
      },
    },
    totalSessions: 1,
    totalMessages: 1,
    hourCounts: { "10": 1 },
    firstSessionDate: "2026-06-01",
  }));

  return { root, cacheDir: root };
}

function writeDisjointCacheAndJsonlFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-disjoint-"));
  tempDirs.push(root);

  // Live JSONL transcripts cover the recent dates Claude still keeps on disk.
  const projectDir = path.join(root, "projects", "-home-alice-app");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, "session.jsonl"), [
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-01T10:00:00",
      cwd: "/home/alice/app",
      sessionId: "session-A",
      message: {
        role: "assistant",
        model: "claude-sonnet-4",
        usage: { input_tokens: 1000, output_tokens: 500 },
      },
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-02T11:00:00",
      cwd: "/home/alice/app",
      sessionId: "session-B",
      message: {
        role: "assistant",
        model: "claude-sonnet-4",
        usage: { input_tokens: 2000, output_tokens: 1000 },
      },
    }),
  ].join("\n"));

  // Frozen cache retains older history that Claude has since pruned from disk.
  writeFileSync(path.join(root, "stats-cache.json"), JSON.stringify({
    version: 3,
    lastComputedDate: "2026-05-31",
    dailyActivity: [
      { date: "2026-05-30", messageCount: 4, sessionCount: 1, toolCallCount: 0 },
      { date: "2026-05-31", messageCount: 6, sessionCount: 2, toolCallCount: 0 },
    ],
    dailyModelTokens: [
      { date: "2026-05-30", tokensByModel: { "claude-opus": 1000 } },
      { date: "2026-05-31", tokensByModel: { "claude-opus": 2000 } },
    ],
    modelUsage: {
      "claude-opus": {
        inputTokens: 1800,
        outputTokens: 600,
        cacheReadInputTokens: 400,
        cacheCreationInputTokens: 200,
        costUSD: 5,
      },
    },
    totalSessions: 3,
    totalMessages: 10,
    hourCounts: { "8": 4, "9": 6 },
    firstSessionDate: "2026-05-30",
  }));

  return root;
}

function writeStreamingMessageIdFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-msgid-"));
  tempDirs.push(root);
  const projectDir = path.join(root, "projects", "-home-alice-app");
  mkdirSync(projectDir, { recursive: true });

  // One API response (message.id "msg-stream") logged as several JSONL lines,
  // each repeating the same usage. Two streaming snapshots (output 1) precede
  // the completed line (output 500); a fourth line is a separate response.
  const lineFor = (uuid: string, msgId: string, output: number) => JSON.stringify({
    type: "assistant",
    uuid,
    timestamp: "2026-06-23T10:00:00",
    sessionId: "session-1",
    message: {
      id: msgId,
      role: "assistant",
      model: "claude-opus-4-8",
      usage: { input_tokens: 100, output_tokens: output, cache_read_input_tokens: 5000 },
    },
  });

  writeFileSync(path.join(projectDir, "session.jsonl"), [
    lineFor("u1", "msg-stream", 1),
    lineFor("u2", "msg-stream", 1),
    lineFor("u3", "msg-stream", 500),
    lineFor("u4", "msg-second", 200),
  ].join("\n"));

  // A resumed session copies the completed msg-stream line into a second file
  // (new uuid, same message.id) — it must still collapse to the one response.
  writeFileSync(path.join(projectDir, "resumed.jsonl"), lineFor("u5", "msg-stream", 500));

  return path.join(root, "projects");
}

function writeDuplicateUuidFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-dupuuid-"));
  tempDirs.push(root);

  const projectDir = path.join(root, "projects", "-home-alice-app");
  mkdirSync(projectDir, { recursive: true });

  // The same assistant message (uuid msg-1) appears in both an original session
  // file and a resumed/forked one — exactly how Claude Code copies transcripts.
  const sharedMessage = {
    type: "assistant",
    uuid: "msg-1",
    timestamp: "2026-06-01T10:00:00",
    cwd: "/home/alice/app",
    sessionId: "session-1",
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000 },
    },
  };
  const uniqueMessage = {
    type: "assistant",
    uuid: "msg-2",
    timestamp: "2026-06-01T11:00:00",
    cwd: "/home/alice/app",
    sessionId: "session-2",
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      usage: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 2000 },
    },
  };

  writeFileSync(path.join(projectDir, "session-1.jsonl"), JSON.stringify(sharedMessage));
  writeFileSync(
    path.join(projectDir, "session-2.jsonl"),
    [JSON.stringify(sharedMessage), JSON.stringify(uniqueMessage)].join("\n")
  );

  return path.join(root, "projects");
}

function writeOverlapCacheAndJsonlFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-overlap-"));
  tempDirs.push(root);

  // Live JSONL covers 2026-06-01 — a date the frozen cache also still claims.
  // This is the overlap case: the disjoint fixture exercises cacheFraction = 1,
  // this one forces cacheFraction < 1 so the model/cost scaling actually runs.
  const projectDir = path.join(root, "projects", "-home-alice-app");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, "session.jsonl"), JSON.stringify({
    type: "assistant",
    timestamp: "2026-06-01T10:00:00",
    cwd: "/home/alice/app",
    sessionId: "session-X",
    message: {
      role: "assistant",
      model: "claude-sonnet-4",
      usage: { input_tokens: 800, output_tokens: 200 },
    },
  }));

  // Frozen cache: three dates of opus, one of which (06-01) overlaps the JSONL.
  // dailyModelTokens sum (3000) == modelUsage token total (3000), so the cache's
  // internal scaleFactor stays 1 and the numbers here reach mergeClaudeStats as-is.
  writeFileSync(path.join(root, "stats-cache.json"), JSON.stringify({
    version: 3,
    lastComputedDate: "2026-06-01",
    dailyActivity: [
      { date: "2026-05-30", messageCount: 2, sessionCount: 1, toolCallCount: 0 },
      { date: "2026-05-31", messageCount: 3, sessionCount: 1, toolCallCount: 0 },
      { date: "2026-06-01", messageCount: 4, sessionCount: 2, toolCallCount: 0 },
    ],
    dailyModelTokens: [
      { date: "2026-05-30", tokensByModel: { "claude-opus": 1000 } },
      { date: "2026-05-31", tokensByModel: { "claude-opus": 1000 } },
      { date: "2026-06-01", tokensByModel: { "claude-opus": 1000 } },
    ],
    modelUsage: {
      "claude-opus": {
        inputTokens: 1500,
        outputTokens: 1000,
        cacheReadInputTokens: 300,
        cacheCreationInputTokens: 200,
        costUSD: 6,
      },
    },
    totalSessions: 6,
    totalMessages: 9,
    hourCounts: { "9": 4, "14": 5 },
    firstSessionDate: "2026-05-30",
  }));

  return root;
}

function writeEmptyCacheWithJsonlFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-empty-cache-"));
  tempDirs.push(root);

  const projectDir = path.join(root, "projects", "-home-alice-app");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, "session.jsonl"), [
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-01T10:00:00",
      sessionId: "session-1",
      message: {
        role: "assistant",
        model: "claude-sonnet-4",
        usage: { input_tokens: 800, output_tokens: 400 },
      },
    }),
  ].join("\n"));

  writeFileSync(path.join(root, "stats-cache.json"), JSON.stringify({
    version: 1,
    lastComputedDate: "2026-06-01",
    dailyActivity: [],
    dailyModelTokens: [],
    modelUsage: {},
    totalSessions: 0,
    totalMessages: 0,
    hourCounts: {},
    firstSessionDate: "",
  }));

  return root;
}

describe("claude.parse", () => {
  it("parses Claude stats-cache totals and daily activity", () => {
    const stats = parse(writeClaudeFixture());

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      harness: "claude",
      totalTokens: 1000,
      totalInputTokens: 500,
      totalOutputTokens: 400,
      totalCacheTokens: 100,
      totalTurns: 5,
      totalSessions: 2,
      activeDays: 2,
      bestDay: { date: "2026-06-01", tokens: 600, turns: 3, cost: 0 },
      dailyActivity: [
        { date: "2026-05-31", tokens: 400, turns: 2, cost: 0 },
        { date: "2026-06-01", tokens: 600, turns: 3, cost: 0 },
      ],
    });
    expect(stats!.totalCost).toBeCloseTo(3.23);
    expect(stats!.modelActivity).toEqual(expect.arrayContaining([
      {
        model: "claude-sonnet",
        harness: "claude",
        tokens: 350,
        inputTokens: 100,
        outputTokens: 200,
        cacheTokens: 50,
        cost: 1.23,
      },
      {
        model: "claude-opus",
        harness: "claude",
        tokens: 650,
        inputTokens: 400,
        outputTokens: 200,
        cacheTokens: 50,
        cost: 2,
      },
    ]));
  });

  it("filters model-specific totals without guessing unavailable session metadata", () => {
    const stats = parse(writeClaudeFixture(), "sonnet");

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 350,
      totalInputTokens: 100,
      totalOutputTokens: 200,
      totalCacheTokens: 50,
      totalTurns: 0,
      totalSessions: 0,
      hourlyActivity: [],
      dailyActivity: [
        { date: "2026-05-31", tokens: 100, turns: 0, cost: 0 },
        { date: "2026-06-01", tokens: 250, turns: 0, cost: 0 },
      ],
    });
    expect(stats!.modelActivity).toHaveLength(1);
    expect(stats!.modelActivity[0].model).toBe("claude-sonnet");
  });

  it("returns null when a model filter has no matching usage", () => {
    expect(parse(writeClaudeFixture(), "missing-model")).toBeNull();
  });

  it("falls back to Claude Code project JSONL logs when stats-cache is absent", () => {
    const root = writeClaudeProjectsFixture();
    const stats = parse(root);

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      harness: "claude",
      sourcePath: path.join(root, "projects"),
      totalTokens: 480,
      totalInputTokens: 300,
      totalOutputTokens: 150,
      totalCacheTokens: 30,
      totalCost: 0,
      totalTurns: 2,
      totalSessions: 1,
      activeDays: 1,
      bestDay: { date: "2026-06-01", tokens: 480, turns: 2, cost: 0 },
      dailyActivity: [
        { date: "2026-06-01", tokens: 480, turns: 2, cost: 0 },
      ],
      projectActivity: [
        { project: "/home/alice/secret-app", harness: "claude", tokens: 480 },
      ],
      hourlyActivity: [
        { hour: 9, tokens: 480, turns: 2 },
      ],
    });
    expect(stats!.modelActivity).toEqual([
      {
        model: "claude-opus-4",
        harness: "claude",
        tokens: 300,
        inputTokens: 200,
        outputTokens: 100,
        cacheTokens: 0,
        cost: 0,
      },
      {
        model: "claude-sonnet-4",
        harness: "claude",
        tokens: 180,
        inputTokens: 100,
        outputTokens: 50,
        cacheTokens: 30,
        cost: 0,
      },
    ]);
  });

  it("filters Claude project JSONL logs by model", () => {
    const stats = parse(writeClaudeProjectsFixture(), "sonnet");

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      totalTokens: 180,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheTokens: 30,
      totalTurns: 1,
      totalSessions: 1,
      dailyActivity: [
        { date: "2026-06-01", tokens: 180, turns: 1, cost: 0 },
      ],
    });
    expect(stats!.modelActivity).toHaveLength(1);
    expect(stats!.modelActivity[0].model).toBe("claude-sonnet-4");
  });

  it("accepts the Claude projects directory directly", () => {
    const root = writeClaudeProjectsFixture();
    const projectsDir = path.join(root, "projects");
    const stats = parse(projectsDir);

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      sourcePath: projectsDir,
      totalTokens: 480,
      totalTurns: 2,
      totalSessions: 1,
    });
  });

  it("parses JSONL entries with top-level usage and model (no message wrapper)", () => {
    const root = writeTopLevelUsageFixture();
    const stats = parse(root);

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      harness: "claude",
      totalTokens: 750,
      totalInputTokens: 500,
      totalOutputTokens: 200,
      totalCacheTokens: 50,
      totalTurns: 1,
      totalSessions: 1,
    });
    expect(stats!.modelActivity).toEqual([
      { model: "claude-sonnet-4", harness: "claude", tokens: 750, inputTokens: 500, outputTokens: 200, cacheTokens: 50, cost: 0 },
    ]);
  });

  it("prefers JSONL over stale stats-cache when JSONL has more tokens", () => {
    const { root } = writeStaleCacheWithJsonlFixture();
    const stats = parse(root);

    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(4500);
    expect(stats!.dailyActivity).toHaveLength(2);
    expect(stats!.totalTurns).toBe(2);
  });

  it("merges older stats-cache history with newer JSONL by date", () => {
    const root = writeDisjointCacheAndJsonlFixture();
    const stats = parse(root);

    expect(stats).not.toBeNull();
    // Recent JSONL dates and pruned cache-only dates both survive.
    expect(stats!.dailyActivity).toEqual([
      { date: "2026-05-30", tokens: 1000, turns: 4, cost: 0 },
      { date: "2026-05-31", tokens: 2000, turns: 6, cost: 0 },
      { date: "2026-06-01", tokens: 1500, turns: 1, cost: 0 },
      { date: "2026-06-02", tokens: 3000, turns: 1, cost: 0 },
    ]);
    expect(stats!.activeDays).toBe(4);
    expect(stats!.totalTokens).toBe(7500);
    expect(stats!.totalInputTokens).toBe(4800);
    expect(stats!.totalOutputTokens).toBe(2100);
    expect(stats!.totalCacheTokens).toBe(600);
    expect(stats!.totalCost).toBeCloseTo(5);
    expect(stats!.totalTurns).toBe(12);
    expect(stats!.totalSessions).toBe(5);
    expect(stats!.bestDay).toEqual({ date: "2026-06-02", tokens: 3000 });
    expect(stats!.modelActivity).toEqual([
      { model: "claude-sonnet-4", harness: "claude", tokens: 4500, inputTokens: 3000, outputTokens: 1500, cacheTokens: 0, cost: 0 },
      { model: "claude-opus", harness: "claude", tokens: 3000, inputTokens: 1800, outputTokens: 600, cacheTokens: 600, cost: 5 },
    ]);
  });

  it("drops cache tokens for dates JSONL also covers, and scales cache aggregates by the kept share", () => {
    const root = writeOverlapCacheAndJsonlFixture();
    const stats = parse(root);

    expect(stats).not.toBeNull();
    // JSONL owns 2026-06-01, so the cache's 1000 opus tokens for that date drop
    // out entirely (not added on top of JSONL). The two surviving cache dates hold
    // 2000 of the cache's 3000 daily tokens, so cacheFraction = 2/3.
    expect(stats!.dailyActivity).toEqual([
      { date: "2026-05-30", tokens: 1000, turns: 2, cost: 0 },
      { date: "2026-05-31", tokens: 1000, turns: 3, cost: 0 },
      { date: "2026-06-01", tokens: 1000, turns: 1, cost: 0 }, // JSONL only
    ]);
    expect(stats!.activeDays).toBe(3);
    // All three days tie at 1000 tokens; the reducer keeps the first (earliest date).
    expect(stats!.bestDay).toEqual({ date: "2026-05-30", tokens: 1000 });

    // claude-opus: the cache's lifetime aggregates scaled by 2/3. The cache carries
    // no per-date model breakdown, so this is a global-share approximation, not an
    // exact per-model-by-date computation. tokens/input/cost land clean; output/cache
    // hit the Math.round path (1000*2/3=666.67->667, 500*2/3=333.33->333). cost is the
    // one field left unrounded through the merge (6*2/3=4 exactly here).
    // claude-sonnet-4: full JSONL values, unscaled. Sorted by tokens desc.
    expect(stats!.modelActivity).toEqual([
      { model: "claude-opus", harness: "claude", tokens: 2000, inputTokens: 1000, outputTokens: 667, cacheTokens: 333, cost: 4 },
      { model: "claude-sonnet-4", harness: "claude", tokens: 1000, inputTokens: 800, outputTokens: 200, cacheTokens: 0, cost: 0 },
    ]);

    // Header totals derive from the rounded modelActivity sums, so they always match
    // `--by model` exactly.
    expect(stats!.totalTokens).toBe(3000);
    expect(stats!.totalInputTokens).toBe(1800);
    expect(stats!.totalOutputTokens).toBe(867);
    expect(stats!.totalCacheTokens).toBe(333);
    expect(stats!.totalCost).toBe(4);

    // Turns are exact: JSONL turns (1) + the cache's surviving per-date turns (2+3).
    // Sessions scale like the model totals: JSONL (1) + round(cacheSessions * 2/3) = round(6*2/3) = 4.
    expect(stats!.totalTurns).toBe(6);
    expect(stats!.totalSessions).toBe(5);
  });

  it("collapses multiple JSONL lines sharing one message.id into a single response", () => {
    const stats = parse(writeStreamingMessageIdFixture());

    expect(stats).not.toBeNull();
    // msg-stream counts once with the COMPLETED line (output 500), not summed
    // across its three lines: 100 + 500 + 5000 = 5600 — and the cross-file
    // resume copy of it does not add again. msg-second: 100 + 200 + 5000 = 5300.
    // Total 10900 — the raw 5-line sum would be 26203.
    expect(stats!.totalTokens).toBe(10900);
    expect(stats!.totalOutputTokens).toBe(700);
    expect(stats!.totalInputTokens).toBe(200);
    expect(stats!.totalCacheTokens).toBe(10000);
    expect(stats!.totalTurns).toBe(2);
    // All lines share one sessionId, so dedup must not inflate the session count.
    expect(stats!.totalSessions).toBe(1);
  });

  it("counts a duplicated message uuid once across resumed session files", () => {
    const stats = parse(writeDuplicateUuidFixture());

    expect(stats).not.toBeNull();
    // msg-1 (1150 tokens) appears twice but counts once; msg-2 adds 2300.
    expect(stats!.totalTokens).toBe(3450);
    expect(stats!.totalInputTokens).toBe(300);
    expect(stats!.totalOutputTokens).toBe(150);
    expect(stats!.totalCacheTokens).toBe(3000);
    expect(stats!.totalTurns).toBe(2);
  });

  it("uses JSONL when stats-cache exists but has zero tokens", () => {
    const root = writeEmptyCacheWithJsonlFixture();
    const stats = parse(root);

    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(1200);
    expect(stats!.totalInputTokens).toBe(800);
    expect(stats!.totalOutputTokens).toBe(400);
  });

  it("returns null when given a nonexistent path", () => {
    expect(parse("/nonexistent/claude/path")).toBeNull();
  });

  it("returns null for a directory with no JSONL files and no cache", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-empty-"));
    tempDirs.push(root);
    mkdirSync(path.join(root, "projects"), { recursive: true });

    expect(parse(root)).toBeNull();
  });

  it("skips user-type entries in JSONL files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-useronly-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "projects", "-home-alice-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "session.jsonl"), [
      JSON.stringify({
        type: "user",
        timestamp: "2026-06-01T10:00:00",
        message: { role: "user", content: "hello" },
      }),
    ].join("\n"));

    expect(parse(root)).toBeNull();
  });

  it("excludes synthetic model from model activity", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-synthetic-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "projects", "-home-user-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "session.jsonl"), [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-01T10:00:00",
        sessionId: "session-1",
        message: {
          role: "assistant",
          model: "<synthetic>",
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-01T10:01:00",
        sessionId: "session-1",
        message: {
          role: "assistant",
          model: "claude-sonnet-4",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ].join("\n"));

    const stats = parse(root);
    expect(stats).not.toBeNull();
    expect(stats!.modelActivity).toHaveLength(1);
    expect(stats!.modelActivity[0].model).toBe("claude-sonnet-4");
    expect(stats!.totalTokens).toBe(150);
  });

  it("includes reasoning tokens in total", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-reasoning-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "projects", "-home-user-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "session.jsonl"), [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-01T10:00:00",
        sessionId: "session-1",
        message: {
          role: "assistant",
          model: "claude-opus-4-7",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            reasoning_output_tokens: 500,
          },
        },
      }),
    ].join("\n"));

    const stats = parse(root);
    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(650);
    expect(stats!.modelActivity[0].tokens).toBe(650);
  });

  it("tracks multiple projects separately in projectActivity", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-multi-"));
    tempDirs.push(root);

    const projectDir1 = path.join(root, "projects", "-home-alice-project-a");
    mkdirSync(projectDir1, { recursive: true });
    writeFileSync(path.join(projectDir1, "session.jsonl"), [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-01T10:00:00",
        cwd: "/home/alice/project-a",
        sessionId: "session-a",
        message: {
          role: "assistant",
          model: "claude-sonnet-4",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ].join("\n"));

    const projectDir2 = path.join(root, "projects", "-home-alice-project-b");
    mkdirSync(projectDir2, { recursive: true });
    writeFileSync(path.join(projectDir2, "session.jsonl"), [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-01T11:00:00",
        cwd: "/home/alice/project-b",
        sessionId: "session-b",
        message: {
          role: "assistant",
          model: "claude-sonnet-4",
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      }),
    ].join("\n"));

    const stats = parse(root);
    expect(stats).not.toBeNull();
    expect(stats!.projectActivity).toHaveLength(2);
    expect(stats!.totalSessions).toBe(2);
    expect(stats!.totalTokens).toBe(450);
    const projects = stats!.projectActivity.map((p) => p.project);
    expect(projects).toContain("/home/alice/project-a");
    expect(projects).toContain("/home/alice/project-b");
  });

  it("ignores system, attachment, and other non-assistant entry types", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-types-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "projects", "-home-user-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "session.jsonl"), [
      JSON.stringify({ type: "system", timestamp: "2026-06-01T09:00:00", message: "init" }),
      JSON.stringify({ type: "attachment", timestamp: "2026-06-01T09:05:00" }),
      JSON.stringify({ type: "file-history-snapshot", timestamp: "2026-06-01T09:10:00" }),
      JSON.stringify({ type: "ai-title", timestamp: "2026-06-01T09:15:00" }),
      JSON.stringify({ type: "permission-mode", timestamp: "2026-06-01T09:20:00" }),
    ].join("\n"));

    expect(parse(root)).toBeNull();
  });

  it("falls back to total_tokens when individual token fields are absent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-total-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "projects", "-home-user-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "session.jsonl"), [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-01T10:00:00",
        sessionId: "session-1",
        message: {
          role: "assistant",
          model: "claude-sonnet-4",
          usage: { total_tokens: 9999 },
        },
      }),
    ].join("\n"));

    const stats = parse(root);
    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(9999);
  });

  it("parses stats-cache v3 with extra fields without errors", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-v3-"));
    tempDirs.push(dir);
    writeFileSync(path.join(dir, "stats-cache.json"), JSON.stringify({
      version: 3,
      lastComputedDate: "2026-06-02",
      dailyActivity: [
        { date: "2026-06-01", messageCount: 2, sessionCount: 1, toolCallCount: 1 },
      ],
      dailyModelTokens: [
        { date: "2026-06-01", tokensByModel: { "claude-opus-4-7": 500 } },
      ],
      modelUsage: {
        "claude-opus-4-7": {
          inputTokens: 200,
          outputTokens: 100,
          cacheReadInputTokens: 150,
          cacheCreationInputTokens: 50,
          costUSD: 1.5,
        },
      },
      totalSessions: 1,
      totalMessages: 2,
      hourCounts: { "10": 2 },
      firstSessionDate: "2026-06-01",
      longestSession: 3600,
      totalSpeculationTimeSavedMs: 5000,
    }));

    const stats = parse(dir);
    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(500);
    expect(stats!.totalCost).toBeCloseTo(1.5);
    expect(stats!.modelActivity).toHaveLength(1);
    expect(stats!.modelActivity[0].model).toBe("claude-opus-4-7");
  });

  it("excludes synthetic model tokens from stats-cache daily totals", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-cache-synthetic-"));
    tempDirs.push(dir);
    writeFileSync(path.join(dir, "stats-cache.json"), JSON.stringify({
      version: 3,
      lastComputedDate: "2026-06-02",
      dailyActivity: [
        { date: "2026-06-01", messageCount: 2, sessionCount: 1, toolCallCount: 0 },
      ],
      dailyModelTokens: [
        { date: "2026-06-01", tokensByModel: { "<synthetic>": 10000, "claude-sonnet-4": 150 } },
      ],
      modelUsage: {
        "<synthetic>": {
          inputTokens: 10000,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0,
        },
        "claude-sonnet-4": {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0.1,
        },
      },
      totalSessions: 1,
      totalMessages: 2,
      hourCounts: { "10": 2 },
      firstSessionDate: "2026-06-01",
    }));

    const stats = parse(dir);
    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(150);
    expect(stats!.dailyActivity).toEqual([
      { date: "2026-06-01", tokens: 150, turns: 2, cost: 0 },
    ]);
    expect(stats!.modelActivity).toEqual([
      { model: "claude-sonnet-4", harness: "claude", tokens: 150, inputTokens: 100, outputTokens: 50, cacheTokens: 0, cost: 0.1 },
    ]);
  });

  it("recognizes session_id in snake_case format", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-sid-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "projects", "-home-user-app");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "session.jsonl"), [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-01T10:00:00",
        session_id: "snake-case-session",
        message: {
          role: "assistant",
          model: "claude-sonnet-4",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ].join("\n"));

    const stats = parse(root);
    expect(stats).not.toBeNull();
    expect(stats!.totalSessions).toBe(1);
  });

  it("aggregates across multiple JSONL files in the same project", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vibe-o-meter-claude-multi-jsonl-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "projects", "-home-user-app");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(path.join(projectDir, "session-1.jsonl"), [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-01T10:00:00",
        sessionId: "s1",
        message: {
          role: "assistant",
          model: "claude-sonnet-4",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ].join("\n"));

    writeFileSync(path.join(projectDir, "session-2.jsonl"), [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-01T11:00:00",
        sessionId: "s2",
        message: {
          role: "assistant",
          model: "claude-sonnet-4",
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      }),
    ].join("\n"));

    const stats = parse(root);
    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(450);
    expect(stats!.totalSessions).toBe(2);
    expect(stats!.totalTurns).toBe(2);
  });
});
