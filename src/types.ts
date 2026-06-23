export interface DailyActivity {
  date: string;
  tokens: number;
  turns: number;
  cost: number;
}

export interface ModelActivity {
  model: string;
  harness: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cost: number;
}

export interface ProjectActivity {
  project: string;
  harness: string;
  tokens: number;
}

export interface HourlyActivity {
  hour: number;
  tokens: number;
  turns: number;
}

export interface AgentStats {
  harness: string;
  sourcePath: string;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalCost: number;
  totalTurns: number;
  totalSessions: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  bestDay: { date: string; tokens: number };
  dailyActivity: DailyActivity[];
  modelActivity: ModelActivity[];
  projectActivity: ProjectActivity[];
  hourlyActivity: HourlyActivity[];
}

export interface CombinedStats {
  agents: AgentStats[];
  combinedDaily: DailyActivity[];
  allTimeTokens: number;
  allTimeCost: number;
  allTimeActiveDays: number;
}

export type HarnessName = "opencode" | "claude" | "codex" | "pi";

const DISPLAY_NAMES: Record<string, string> = {
  opencode: "opencode",
  claude: "claude code",
  codex: "codex",
  pi: "pi",
};

export function harnessDisplayName(harness: string): string {
  return DISPLAY_NAMES[harness] || harness;
}

export interface CliOptions {
  weeks?: number;
  agent?: string;
  model?: string;
  by?: "model" | "project" | "hour";
  json?: boolean;
  verbose?: boolean;
  db?: string;
  claude?: string;
  codex?: string;
  pi?: string;
}

// Subset of CliOptions passed to source parsers so they can skip work whose
// output is not requested (e.g. OpenCode's per-message model breakdown, which
// only `--by model` and `--json` consume).
export interface ParseOptions {
  by?: CliOptions["by"];
  json?: boolean;
}
