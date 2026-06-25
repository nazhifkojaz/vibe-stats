import { afterEach, describe, expect, it, vi } from "vitest";
import { render, renderJson } from "../src/render/combined";
import { renderByProject } from "../src/render/breakdown";
import { renderHeatmap } from "../src/render/heatmap";
import type { AgentStats, CombinedStats } from "../src/types";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_COLUMNS = process.stdout.columns;
const ORIGINAL_STDOUT_ISTTY = process.stdout.isTTY;
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_FORCE_COLOR = process.env.FORCE_COLOR;
const ORIGINAL_NO_COLOR = process.env.NO_COLOR;
const ORIGINAL_TZ = process.env.TZ;

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function makeStats(overrides: Partial<CombinedStats> = {}): CombinedStats {
  return {
    agents: [],
    combinedDaily: [],
    allTimeTokens: 0,
    allTimeCost: 0,
    allTimeActiveDays: 0,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentStats> = {}): AgentStats {
  return {
    harness: "claude",
    sourcePath: "/tmp/stats-cache.json",
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheTokens: 0,
    totalCost: 0,
    totalTurns: 0,
    totalSessions: 0,
    activeDays: 0,
    currentStreak: 0,
    longestStreak: 0,
    bestDay: { date: "", tokens: 0 },
    dailyActivity: [],
    modelActivity: [],
    projectActivity: [],
    hourlyActivity: [],
    ...overrides,
  };
}

afterEach(() => {
  restoreEnv("HOME", ORIGINAL_HOME);
  Object.defineProperty(process.stdout, "columns", { value: ORIGINAL_COLUMNS, writable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: ORIGINAL_STDOUT_ISTTY, configurable: true, writable: true });
  process.argv = ORIGINAL_ARGV;
  restoreEnv("FORCE_COLOR", ORIGINAL_FORCE_COLOR);
  restoreEnv("NO_COLOR", ORIGINAL_NO_COLOR);
  restoreEnv("TZ", ORIGINAL_TZ);
  vi.useRealTimers();
  vi.resetModules();
});

describe("render", () => {
  it("shows a helpful empty state when no agent data is available", () => {
    const output = render(makeStats(), { weeks: 8 });

    expect(output).toContain("No AI coding agent data found.");
    expect(output).toContain("Checked common local data locations");
    expect(output).toContain("OpenCode");
    expect(output).toContain("$XDG_DATA_HOME/opencode/opencode.db");
    expect(output).toContain("Application Support/opencode/opencode.db");
    expect(output).toContain("Claude Code");
    expect(output).toContain("$XDG_CONFIG_HOME/claude");
    expect(output).toContain("Codex");
    expect(output).toContain("$XDG_CONFIG_HOME/codex");
    expect(output).toContain("Pi");
    expect(output).toContain("$XDG_DATA_HOME/pi/agent/sessions");
    expect(output).toContain("--verbose");
    expect(output).toContain("--claude");
  });
  it("caps heatmap weeks to fit narrow terminals", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 12));
    Object.defineProperty(process.stdout, "columns", { value: 60, writable: true });

    const output = render(makeStats({
      agents: [makeAgent({
        totalTokens: 100,
        dailyActivity: [{ date: "2026-06-01", tokens: 100, turns: 1, cost: 0 }],
      })],
      allTimeTokens: 100,
    }), { weeks: 53 });

    expect(output).toContain("Vibe-o-meter");
    const lines = output.split("\n");
    const dataLines = lines.filter((l) => l.includes("\u25A0") || l.includes("\u2591"));
    for (const line of dataLines) {
      const visible = line.replace(/\x1b\[[0-9;]*m/g, "");
      expect(visible.length).toBeLessThanOrEqual(62);
    }
  });

  it("adapts stats bar width for narrow terminals", () => {
    Object.defineProperty(process.stdout, "columns", { value: 80, writable: true });

    const output = render(makeStats({
      agents: [makeAgent({
        harness: "opencode",
        totalTokens: 5000,
        activeDays: 42,
        longestStreak: 7,
        bestDay: { date: "2026-06-01", tokens: 2000 },
        dailyActivity: [{ date: "2026-06-01", tokens: 5000, turns: 5, cost: 0 }],
      })],
      allTimeTokens: 5000,
      allTimeActiveDays: 42,
    }), { weeks: 8 });

    expect(output).not.toContain("Less");
    expect(output).not.toContain("More");
    expect(output).not.toContain("peak");
  });

  it("shows full stats on wide terminals", () => {
    Object.defineProperty(process.stdout, "columns", { value: 120, writable: true });

    const output = render(makeStats({
      agents: [makeAgent({
        harness: "opencode",
        totalTokens: 5000,
        activeDays: 42,
        longestStreak: 7,
        bestDay: { date: "2026-06-01", tokens: 2000 },
        dailyActivity: [{ date: "2026-06-01", tokens: 5000, turns: 5, cost: 0 }],
      })],
      allTimeTokens: 5000,
      allTimeActiveDays: 42,
    }), { weeks: 8 });

    expect(output).toContain("Less");
    expect(output).toContain("More");
    expect(output).toContain("peak");
  });
});

describe("color handling", () => {
  function sample(): CombinedStats {
    return makeStats({
      agents: [makeAgent({
        harness: "opencode",
        totalTokens: 5000,
        activeDays: 42,
        longestStreak: 7,
        bestDay: { date: "2026-06-01", tokens: 2000 },
        dailyActivity: [{ date: "2026-06-01", tokens: 5000, turns: 5, cost: 0 }],
      })],
      combinedDaily: [{ date: "2026-06-01", tokens: 5000, turns: 5, cost: 0 }],
      allTimeTokens: 5000,
      allTimeActiveDays: 42,
    });
  }

  // Color is resolved at module load in src/color.ts, so re-import a fresh module
  // graph after setting the environment.
  async function renderWithFreshColor(): Promise<string> {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 2, 12));
    Object.defineProperty(process.stdout, "columns", { value: 120, writable: true });
    // Pretend stdout is an interactive terminal so the no-TTY default doesn't
    // mask whether NO_COLOR / --no-color actually turn color off.
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true, writable: true });
    const { render: freshRender } = await import("../src/render/combined");
    return freshRender(sample(), { weeks: 8 });
  }

  it("emits ANSI escapes when color is forced on", async () => {
    process.argv = ["node", "vibe-o-meter"];
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    const output = await renderWithFreshColor();
    expect(output).toContain("\x1b[");
  });

  it("emits no ANSI escapes when color is disabled", async () => {
    process.argv = ["node", "vibe-o-meter"];
    delete process.env.FORCE_COLOR;
    process.env.NO_COLOR = "1";
    const output = await renderWithFreshColor();
    expect(output).not.toContain("\x1b[");
  });

  it("disables color via the --no-color flag even with a forced TTY env", async () => {
    process.argv = ["node", "vibe-o-meter", "--no-color"];
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    const output = await renderWithFreshColor();
    expect(output).not.toContain("\x1b[");
  });
});

describe("heatmap month header", () => {
  it("places month labels independent of timezone (UTC off-by-one regression)", () => {
    vi.useFakeTimers();
    // 2026-08-01 is a Saturday — the last cell of its week column. With the old
    // `new Date(date).getDate()` check, a negative-UTC-offset timezone reads it as
    // Jul 31 and shifts the "Aug" label one column right. 18:00Z keeps "today" on
    // the same calendar day in UTC and Los Angeles, so the grid is identical and
    // only the (now fixed) header detection could differ between the two renders.
    vi.setSystemTime(new Date("2026-08-20T18:00:00Z"));

    process.env.TZ = "UTC";
    const utcHeader = renderHeatmap([], 8, "Test", 0).split("\n")[2];
    process.env.TZ = "America/Los_Angeles";
    const laHeader = renderHeatmap([], 8, "Test", 0).split("\n")[2];

    expect(laHeader).toContain("Aug");
    expect(laHeader).toBe(utcHeader);
  });

  it("places month labels correctly across a DST transition", () => {
    vi.useFakeTimers();
    // Window spans the 2026-03-08 US spring-forward. 18:00Z keeps "today" on the
    // same calendar day in both zones, so only week bucketing (dateToGrid) can
    // differ — guards against the ms-division weekIdx that drifts across DST.
    vi.setSystemTime(new Date("2026-03-20T18:00:00Z"));

    process.env.TZ = "UTC";
    const utcHeader = renderHeatmap([], 6, "Test", 0).split("\n")[2];
    process.env.TZ = "America/Los_Angeles";
    const laHeader = renderHeatmap([], 6, "Test", 0).split("\n")[2];

    expect(laHeader).toContain("Mar");
    expect(laHeader).toBe(utcHeader);
  });
});

describe("renderJson", () => {
  it("redacts local source paths and absolute project paths", () => {
    process.env.HOME = "/home/alice";

    const output = JSON.parse(renderJson(makeStats({
      agents: [makeAgent({
        sourcePath: "/home/alice/.claude/stats-cache.json",
        projectActivity: [
          { project: "/home/alice/projects/secret-app", harness: "claude", tokens: 100 },
          { project: "relative-project", harness: "claude", tokens: 50 },
        ],
      })],
    })));

    expect(output.agents[0].sourcePath).toBe("~/.claude/stats-cache.json");
    expect(output.agents[0].projectActivity[0].project).toBe("secret-app");
    expect(output.agents[0].projectActivity[1].project).toBe("relative-project");
  });
});

describe("renderByProject", () => {
  it("warns that Claude per-project data only covers recent on-disk transcripts", () => {
    const output = renderByProject([
      makeAgent({
        harness: "claude",
        projectActivity: [{ project: "/home/alice/app", harness: "claude", tokens: 1000 }],
      }),
    ]);

    expect(output).toContain("auto-deletes older sessions");
    expect(output).toContain("cleanupPeriodDays");
  });

  it("omits the Claude retention note when no Claude project data is shown", () => {
    const output = renderByProject([
      makeAgent({
        harness: "opencode",
        projectActivity: [{ project: "/home/alice/app", harness: "opencode", tokens: 1000 }],
      }),
    ]);

    expect(output).not.toContain("cleanupPeriodDays");
  });
});
