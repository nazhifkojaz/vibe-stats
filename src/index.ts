import os from "os";
import path from "path";
import { collectAll } from "./sources/registry";
import { buildCombined, filterTimeRange } from "./compute";
import { render, renderJson } from "./render/combined";
import { checkForUpdate } from "./update-check";
import type { CliOptions } from "./types";

const VALID_BREAKDOWNS = new Set(["model", "project", "hour"]);

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--week":
      case "--weeks":
        options.weeks = parseWeeks(readOptionValue(args, ++i, arg));
        break;
      case "--agent":
        options.agent = readOptionValue(args, ++i, arg);
        break;
      case "--model":
        options.model = readOptionValue(args, ++i, arg);
        break;
      case "--by":
        options.by = parseBreakdown(readOptionValue(args, ++i, arg));
        break;
      case "--json":
        options.json = true;
        break;
      case "--color":
      case "--no-color":
        // Color is resolved at module load in src/color.ts (it reads
        // process.argv directly); listed here only so they're accepted options.
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--db":
        options.db = readOptionValue(args, ++i, arg);
        break;
      case "--claude":
        options.claude = readOptionValue(args, ++i, arg);
        break;
      case "--codex":
        options.codex = readOptionValue(args, ++i, arg);
        break;
      case "--pi":
        options.pi = readOptionValue(args, ++i, arg);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return options;
}

function readOptionValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    fail(`Missing value for ${option}`);
  }
  return resolvePath(value);
}

function resolvePath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(1));
  }
  if (p === "~") {
    return os.homedir();
  }
  return p;
}

function parseWeeks(value: string): number {
  const weeks = Number(value);
  if (!Number.isInteger(weeks) || weeks < 1) {
    fail("--weeks must be a positive integer");
  }
  return weeks;
}

function parseBreakdown(value: string): CliOptions["by"] {
  if (!VALID_BREAKDOWNS.has(value)) {
    fail("--by must be one of: model, project, hour");
  }
  return value as CliOptions["by"];
}

function fail(message: string): never {
  console.error(message);
  printHelp();
  process.exit(1);
}

function printHelp() {
  console.log(`
vibe-o-meter — AI coding agent usage visualizer

USAGE
  vibe-o-meter [options]

OPTIONS
  --week, --weeks <n>
                     Number of calendar week columns to show (default: 53)
  --agent <names>    Filter to one or more harnesses, comma-separated (opencode,claude,codex,pi)
  --model <name>     Filter to a specific model (substring match, e.g. gpt-4o)
  --by <dimension>   Breakdown: model, project, hour
  --json             Output raw JSON
  --color, --no-color
                     Force or disable ANSI color (default: auto-detect; also honors NO_COLOR / FORCE_COLOR)
  -v, --verbose      Show path detection debug info
  --db <path>        Override OpenCode DB path
  --claude <path>    Override Claude data path (stats-cache file or projects dir)
  --codex <path>     Override Codex data path (state DB, .codex dir, or sessions dir)
  --pi <path>        Override Pi sessions dir path
  -h, --help         Show this help

EXAMPLES
  vibe-o-meter                          Combined heatmap + stats
  vibe-o-meter --agent opencode         OpenCode only
  vibe-o-meter --agent opencode,claude  OpenCode and Claude
  vibe-o-meter --model gpt-4o           Filter to gpt-4o model across all agents
  vibe-o-meter --by model               Token breakdown by model
  vibe-o-meter --by project             Token breakdown by project
  vibe-o-meter --by hour                Activity by hour of day
  vibe-o-meter --weeks 8 --json         8 weeks as JSON
`);
}

async function main() {
  const options = parseArgs();
  const agents = await collectAll(options);
  const combined = buildCombined(agents);

  const weeks = options.weeks || 53;

  const filtered = filterTimeRange(combined.agents, weeks);
  const filteredCombined = buildCombined(filtered);
  const renderedCombined = options.by ? combined : filteredCombined;

  if (options.json) {
    console.log(renderJson(filteredCombined));
  } else {
    console.log(render(renderedCombined, { weeks, by: options.by }));
  }

  await checkForUpdate();
}

main();
