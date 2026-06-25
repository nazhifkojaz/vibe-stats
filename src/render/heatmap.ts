import type { DailyActivity, AgentStats } from "../types";
import { ANSI_RESET, ANSI_DIM, ANSI_BOLD, EMPTY_COLOR, formatTokens, formatDateLocal, HARNESS_PALETTES, DEFAULT_PALETTE } from "./format";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const BLOCK = "\u25A0";

const LABEL_WIDTH = 4;
const CELL_WIDTH = 2;

function getLevel(tokens: number, thresholds: number[]): number {
  if (tokens === 0) return -1;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (tokens >= thresholds[i]) return i;
  }
  return 0;
}

function computeThresholds(values: number[]): number[] {
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return [1];
  const p = (pct: number) => positive[Math.floor(positive.length * pct)];
  return [positive[0], p(0.15), p(0.35), p(0.55), p(0.75), p(0.9), positive[positive.length - 1]];
}

function dateToGrid(weeks: number): { startDate: Date; endDate: Date; grid: (DailyActivity | null)[][] } {
  const today = new Date();
  const dayOfWeek = today.getDay();

  const endDate = new Date(today);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (weeks - 1) * 7 - dayOfWeek);

  const grid: (DailyActivity | null)[][] = [];
  for (let dow = 0; dow < 7; dow++) {
    grid[dow] = [];
    for (let w = 0; w < weeks; w++) {
      grid[dow][w] = null;
    }
  }

  const d = new Date(startDate);
  let dayIndex = 0;
  while (d <= endDate) {
    const dow = d.getDay();
    // Count calendar days from the (Sunday-aligned) start instead of dividing
    // elapsed ms by a 7-day span. Across a DST transition a local week is not
    // exactly 7 * 86400000 ms, so the ms-based index bucketed days near the
    // change into the wrong column (e.g. dropping a month header under
    // America/Los_Angeles around the March spring-forward).
    const weekIdx = Math.floor(dayIndex / 7);
    if (weekIdx >= 0 && weekIdx < weeks) {
      grid[dow][weekIdx] = {
        date: formatDateLocal(d),
        tokens: 0,
        turns: 0,
        cost: 0,
      };
    }
    d.setDate(d.getDate() + 1);
    dayIndex++;
  }

  return { startDate, endDate, grid };
}

function renderMonthHeader(grid: (DailyActivity | null)[][], weeks: number): string {
  // Build header as a flat array of display characters.
  // Total width = LABEL_WIDTH prefix + weeks * CELL_WIDTH data columns.
  const totalWidth = LABEL_WIDTH + weeks * CELL_WIDTH;
  const headerChars: string[] = new Array(totalWidth).fill(" ");

  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    let monthOfFirstDay = -1;
    for (let dow = 0; dow < 7; dow++) {
      const cell = grid[dow]?.[w];
      if (cell) {
        // Parse the date string in local terms via parseDateParts. Using
        // `new Date(cell.date).getDate()` would parse "YYYY-MM-DD" as UTC
        // midnight, so in any negative-UTC-offset timezone the 1st reads as the
        // prior day and the month label lands in the wrong column.
        const p = parseDateParts(cell.date);
        if (p.day === 1) {
          monthOfFirstDay = p.month;
          break;
        }
      }
    }

    if (monthOfFirstDay !== -1 && monthOfFirstDay !== lastMonth) {
      const label = MONTH_LABELS[monthOfFirstDay].slice(0, 3);
      const startCol = LABEL_WIDTH + w * CELL_WIDTH;
      for (let i = 0; i < label.length && startCol + i < totalWidth; i++) {
        headerChars[startCol + i] = label[i];
      }
      lastMonth = monthOfFirstDay;
    }
  }

  return ANSI_DIM + headerChars.join("") + ANSI_RESET;
}

function buildDominantHarness(agents: AgentStats[]): Map<string, string> {
  const best = new Map<string, { harness: string; tokens: number }>();
  for (const agent of agents) {
    for (const d of agent.dailyActivity) {
      if (d.tokens > 0) {
        const existing = best.get(d.date);
        if (!existing || d.tokens > existing.tokens) {
          best.set(d.date, { harness: agent.harness, tokens: d.tokens });
        }
      }
    }
  }
  return new Map([...best.entries()].map(([k, v]) => [k, v.harness]));
}

export function renderHeatmap(
  daily: DailyActivity[],
  weeks: number,
  title: string,
  totalTokens: number,
  agents: AgentStats[] = []
): string {
  const { endDate, grid } = dateToGrid(weeks);

  const dailyMap = new Map<string, DailyActivity>();
  for (const d of daily) {
    dailyMap.set(d.date, d);
  }

  for (let dow = 0; dow < 7; dow++) {
    for (let w = 0; w < weeks; w++) {
      if (grid[dow][w]) {
        const dateStr = grid[dow][w]!.date;
        grid[dow][w] = dailyMap.get(dateStr) || grid[dow][w];
      }
    }
  }

  const allTokenValues: number[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let w = 0; w < weeks; w++) {
      if (grid[dow][w]) {
        const dateStr = grid[dow][w]!.date;
        const d = dailyMap.get(dateStr);
        if (d && d.tokens > 0) allTokenValues.push(d.tokens);
      }
    }
  }
  const thresholds = computeThresholds(allTokenValues);
  const dominantMap = buildDominantHarness(agents);

  // Determine date range for title
  const firstDate = grid[0][0]?.date;
  const lastDate = formatDateLocal(endDate);
  let dateRange = "";
  if (firstDate) {
    const fd = parseDateParts(firstDate);
    const ld = parseDateParts(lastDate);
    const fStr = `${MONTH_LABELS[fd.month].slice(0, 3)} ${fd.day}, ${fd.year}`;
    const lStr = `${MONTH_LABELS[ld.month].slice(0, 3)} ${ld.day}, ${ld.year}`;
    dateRange = `${fStr} — ${lStr}`;
  }

  const lines: string[] = [];

  lines.push(
    `  ${ANSI_BOLD}${title}${ANSI_RESET}  ${formatTokens(totalTokens)} tokens  ${ANSI_DIM}${dateRange}${ANSI_RESET}`
  );
  lines.push("");

  // Month header with proper alignment
  lines.push(renderMonthHeader(grid, weeks));

  const todayStr = formatDateLocal(new Date());
  const todayDow = new Date().getDay();

  const firstCell = grid[0][0] || grid[1]?.[0] || grid[2]?.[0];
  let firstDow = 0;
  if (firstCell) {
    const p = parseDateParts(firstCell.date);
    firstDow = new Date(p.year, p.month, p.day).getDay();
  }
  const showDays: number[] = [];
  for (let d = 0; d < 7; d++) {
    showDays.push((firstDow + d) % 7);
  }

  const todayShowIdx = showDays.indexOf(todayDow);

  const labelDows = new Set([showDays[0], showDays[2], showDays[4]]);

  for (let i = 0; i < showDays.length; i++) {
    const dow = showDays[i];
    const label = DAY_LABELS[dow];
    let prefix = "";
    if (labelDows.has(dow)) {
      prefix = `${ANSI_DIM}${label}${ANSI_RESET} `;
    } else {
      prefix = "    ";
    }

    let bar = "";
    let currentColor = "";
    for (let w = 0; w < weeks; w++) {
      const cell = grid[dow][w];
      const isAfterEnd = w === weeks - 1 && i > todayShowIdx;
      if (!cell || cell.date > todayStr || isAfterEnd) {
        bar += "  ";
        currentColor = "";
        continue;
      }
      const tokens = cell.tokens || 0;
      const level = getLevel(tokens, thresholds);
      let color;
      if (level < 0) {
        color = EMPTY_COLOR;
      } else {
        const harness = dominantMap.get(cell.date) || "opencode";
        const palette = HARNESS_PALETTES[harness] || DEFAULT_PALETTE;
        color = palette[Math.min(level, palette.length - 1)];
      }
      if (color !== currentColor) {
        bar += color;
        currentColor = color;
      }
      bar += BLOCK + " ";
    }
    bar += ANSI_RESET;

    lines.push(prefix + bar);
  }

  return lines.join("\n");
}

function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}
