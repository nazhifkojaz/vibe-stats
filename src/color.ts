// Single source of truth for whether ANSI color should be emitted.
//
// Precedence (most specific wins):
//   --no-color / --color flag  >  FORCE_COLOR  >  NO_COLOR  >  stdout is a TTY
//
// Detection runs once at module load. `process.argv` is already populated by
// then, so the CLI flags take effect even though `parseArgs()` runs later; this
// lets the render constants in format.ts stay plain values with no per-call-site
// checks. The arguments are injectable so the precedence can be unit-tested.
// `colorEnabled` (below) is for stdout rendering; update-check.ts calls this
// again with `process.stderr` for its warning stream.
export function detectColorEnabled(
  argv: string[] = process.argv,
  env: Record<string, string | undefined> = process.env,
  stream: { isTTY?: boolean } = process.stdout,
): boolean {
  if (argv.includes("--no-color")) return false;
  if (argv.includes("--color")) return true;
  // FORCE_COLOR forces color on, except the conventional "off" values 0 / false
  // (matches chalk / supports-color / Node core). Empty string is treated as
  // unset, mirroring the NO_COLOR check below.
  if (env.FORCE_COLOR) return env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false";
  if (env.NO_COLOR) return false;
  return Boolean(stream.isTTY);
}

export const colorEnabled = detectColorEnabled();
