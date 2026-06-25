import { colorEnabled } from "../color";

// All ANSI lives here so a single `colorEnabled` flag (TTY / NO_COLOR /
// FORCE_COLOR / --color) routes through every escape. When color is disabled
// each constant resolves to "" so the existing concatenations at call sites add
// nothing — no call-site changes needed.
const ansi = (code: string): string => (colorEnabled ? code : "");

export const ANSI_RESET = ansi("\x1b[0m");
export const ANSI_DIM = ansi("\x1b[2m");
export const ANSI_BOLD = ansi("\x1b[1m");
export const ANSI_CYAN = ansi("\x1b[36m");
export const EMPTY_COLOR = ansi("\x1b[38;5;240m");

export function formatTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

export function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const RAW_PALETTES: Record<string, string[]> = {
  opencode: ["\x1b[38;5;22m", "\x1b[38;5;28m", "\x1b[38;5;34m", "\x1b[38;5;40m", "\x1b[38;5;82m", "\x1b[38;5;118m", "\x1b[38;5;155m", "\x1b[38;5;191m"],
  claude:   ["\x1b[38;5;52m", "\x1b[38;5;94m", "\x1b[38;5;130m", "\x1b[38;5;166m", "\x1b[38;5;202m", "\x1b[38;5;208m", "\x1b[38;5;214m", "\x1b[38;5;220m"],
  codex:    ["\x1b[38;5;17m", "\x1b[38;5;19m", "\x1b[38;5;27m", "\x1b[38;5;33m", "\x1b[38;5;39m", "\x1b[38;5;69m", "\x1b[38;5;75m", "\x1b[38;5;117m"],
  pi:       ["\x1b[38;5;53m", "\x1b[38;5;96m", "\x1b[38;5;132m", "\x1b[38;5;168m", "\x1b[38;5;169m", "\x1b[38;5;176m", "\x1b[38;5;218m", "\x1b[38;5;224m"],
};

// Same shape/length whether or not color is on, so `palette[level]` indexing is
// unchanged; the entries are just "" when disabled.
export const HARNESS_PALETTES: Record<string, string[]> = Object.fromEntries(
  Object.entries(RAW_PALETTES).map(([harness, colors]) => [
    harness,
    colorEnabled ? colors : colors.map(() => ""),
  ]),
);

export const DEFAULT_PALETTE = HARNESS_PALETTES.opencode;
