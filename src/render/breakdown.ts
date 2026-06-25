import type { AgentStats } from "../types";
import { harnessDisplayName } from "../types";
import { ANSI_RESET, ANSI_DIM, ANSI_BOLD, ANSI_CYAN, formatTokens } from "./format";

const BAR_CHAR = "\u2588";
const BAR_EMPTY = "\u2591";

export function renderByModel(agents: AgentStats[], termWidth: number = 120): string {
  const modelMap = new Map<string, { tokens: number; harnesses: Set<string> }>();
  for (const agent of agents) {
    for (const m of agent.modelActivity) {
      const existing = modelMap.get(m.model) || { tokens: 0, harnesses: new Set() };
      existing.tokens += m.tokens;
      existing.harnesses.add(agent.harness);
      modelMap.set(m.model, existing);
    }
  }

  const sorted = Array.from(modelMap.entries())
    .filter(([, v]) => v.tokens > 0)
    .sort((a, b) => b[1].tokens - a[1].tokens);

  if (sorted.length === 0) return `  ${ANSI_BOLD}Tokens by Model${ANSI_RESET}\n\n  No model data.`;

  const maxNameLen = Math.max(...sorted.map(([m]) => m.length));
  const nameWidth = Math.min(maxNameLen + 1, 40);
  const maxTokens = sorted[0][1].tokens;
  const totalTokens = sorted.reduce((s, [, v]) => s + v.tokens, 0);
  const fixedWidth = 2 + nameWidth + 10 + 14;
  const barWidth = Math.max(5, Math.min(20, termWidth - fixedWidth));

  const lines: string[] = [];
  lines.push(`  ${ANSI_BOLD}Tokens by Model${ANSI_RESET}`);
  lines.push("");

  for (const [model, data] of sorted) {
    const barLen = Math.max(Math.round((data.tokens / maxTokens) * barWidth), 1);
    const bar = BAR_CHAR.repeat(barLen) + BAR_EMPTY.repeat(barWidth - barLen);
    const pct = ((data.tokens / totalTokens) * 100).toFixed(0);
    const name = model.padEnd(nameWidth);
    const harnesses = Array.from(data.harnesses).map(harnessDisplayName).join(", ");
    lines.push(
      `  ${ANSI_CYAN}${name}${ANSI_RESET}${bar} ${formatTokens(data.tokens).padStart(8)} (${pct}%) ${ANSI_DIM}[${harnesses}]${ANSI_RESET}`
    );
  }

  return lines.join("\n");
}

export function renderByProject(agents: AgentStats[], termWidth: number = 120): string {
  const projectMap = new Map<string, { tokens: number; harnesses: Set<string> }>();
  for (const agent of agents) {
    for (const p of agent.projectActivity) {
      const name = shortenPath(p.project);
      const existing = projectMap.get(name) || { tokens: 0, harnesses: new Set() };
      existing.tokens += p.tokens;
      existing.harnesses.add(agent.harness);
      projectMap.set(name, existing);
    }
  }

  const sorted = Array.from(projectMap.entries()).sort((a, b) => b[1].tokens - a[1].tokens);
  const maxTokens = sorted[0]?.[1].tokens || 1;
  const totalTokens = sorted.reduce((s, [, v]) => s + v.tokens, 0);
  const maxNameLen = Math.max(...sorted.map(([p]) => p.length));
  const nameWidth = Math.min(maxNameLen + 1, 40);
  const fixedWidth = 2 + nameWidth + 10 + 14;
  const barWidth = Math.max(5, Math.min(20, termWidth - fixedWidth));

  const lines: string[] = [];
  lines.push(`  ${ANSI_BOLD}Tokens by Project${ANSI_RESET}`);
  lines.push("");

  for (const [project, data] of sorted) {
    const barLen = Math.max(Math.round((data.tokens / maxTokens) * barWidth), 1);
    const bar = BAR_CHAR.repeat(barLen) + BAR_EMPTY.repeat(barWidth - barLen);
    const pct = ((data.tokens / totalTokens) * 100).toFixed(0);
    const name = project.padEnd(nameWidth);
    const harnesses = Array.from(data.harnesses).map(harnessDisplayName).join(", ");
    lines.push(
      `  ${ANSI_CYAN}${name}${ANSI_RESET}${bar} ${formatTokens(data.tokens).padStart(8)} (${pct}%) ${ANSI_DIM}[${harnesses}]${ANSI_RESET}`
    );
  }

  const noProjectAgents = agents.filter(a => a.projectActivity.length === 0).map(a => harnessDisplayName(a.harness));
  if (noProjectAgents.length > 0) {
    lines.push("");
    lines.push(`  ${ANSI_DIM}Note: ${noProjectAgents.join(", ")} ${noProjectAgents.length === 1 ? "does" : "do"} not report per-project data, so totals may be lower than actual usage.${ANSI_RESET}`);
  }

  // Claude Code stores per-project data only in raw session transcripts, which
  // it auto-deletes past cleanupPeriodDays (default 30). Older usage survives
  // only as a project-less aggregate, so Claude's project totals are recent-only.
  const claudeHasProjects = agents.some(a => a.harness === "claude" && a.projectActivity.length > 0);
  if (claudeHasProjects) {
    lines.push("");
    lines.push(`  ${ANSI_DIM}Note: claude code per-project totals cover only transcripts still on disk; Claude Code auto-deletes older sessions (default ~30 days — raise cleanupPeriodDays to keep more).${ANSI_RESET}`);
  }

  return lines.join("\n");
}

export function renderByHour(agents: AgentStats[], termWidth: number = 120): string {
  const hasTokens = agents.some(a => a.hourlyActivity.some(h => h.tokens > 0));

  const hourlyMap = new Map<number, { tokens: number; turns: number }>();
  for (const agent of agents) {
    for (const h of agent.hourlyActivity) {
      const existing = hourlyMap.get(h.hour) || { tokens: 0, turns: 0 };
      existing.tokens += h.tokens;
      existing.turns += h.turns;
      hourlyMap.set(h.hour, existing);
    }
  }

  const hours: number[] = [];
  for (let h = 0; h < 24; h++) {
    const data = hourlyMap.get(h) || { tokens: 0, turns: 0 };
    hours.push(hasTokens ? data.tokens : data.turns);
  }
  const maxVal = Math.max(...hours, 1);

  const offset = -new Date().getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const offHh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const offMm = String(Math.abs(offset) % 60).padStart(2, "0");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzLabel = `${tz} (UTC${sign}${offHh}:${offMm})`;

  const fixedWidth = 2 + 3 + 10 + 1;
  const barWidth = Math.max(5, Math.min(30, termWidth - fixedWidth));

  const lines: string[] = [];
  lines.push(`  ${ANSI_BOLD}Activity by Hour of Day${ANSI_RESET}  ${ANSI_DIM}${tzLabel}${ANSI_RESET}`);
  lines.push("");

  for (let hour = 0; hour < 24; hour++) {
    const data = hourlyMap.get(hour) || { tokens: 0, turns: 0 };
    const value = hasTokens ? data.tokens : data.turns;
    const barLen = Math.round((value / maxVal) * barWidth);
    const bar = BAR_CHAR.repeat(barLen) + BAR_EMPTY.repeat(barWidth - barLen);
    const label = hour === 0 ? "12a" : hour < 12 ? `${hour}a` : hour === 12 ? "12p" : `${hour - 12}p`;
    const amount = hasTokens
      ? formatTokens(data.tokens).padStart(8)
      : `${String(data.turns).padStart(5)} turns`;
    lines.push(`  ${label.padStart(3)} ${bar} ${ANSI_DIM}${amount}${ANSI_RESET}`);
  }

  lines.push("");

  const peakIdx = hours.indexOf(maxVal);
  const peakVal = hasTokens ? formatTokens(maxVal) : String(maxVal);
  const quietest = Math.min(...hours.filter(v => v > 0));
  const quietIdx = hours.indexOf(quietest);
  const quietVal = hasTokens ? formatTokens(quietest) : String(quietest);

  lines.push(
    `  ${ANSI_DIM}Peak: ${formatHour(peakIdx)} (${peakVal}) | Quietest: ${formatHour(quietIdx)} (${quietVal})${ANSI_RESET}`
  );

  const noHourAgents = agents.filter(a => a.hourlyActivity.length === 0).map(a => a.harness);
  if (noHourAgents.length > 0) {
    lines.push(
      `  ${ANSI_DIM}Note: ${noHourAgents.join(", ")} ${noHourAgents.length === 1 ? "does" : "do"} not report per-hour data, so totals may be lower than actual usage.${ANSI_RESET}`
    );
  }

  if (!hasTokens) {
    lines.push(`  ${ANSI_DIM}Note: showing turn counts because token data is not available for hourly breakdown.${ANSI_RESET}`);
  }

  return lines.join("\n");
}

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

function shortenPath(p: string): string {
  const home = process.env.HOME || "";
  if (home && p.startsWith(home)) {
    return "~" + p.slice(home.length);
  }
  return p;
}
