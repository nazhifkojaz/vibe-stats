import os from "os";
import path from "path";
import type { AgentStats, HarnessName, CliOptions, ParseOptions } from "../types";
import * as opencode from "./opencode";
import * as claude from "./claude";
import * as codex from "./codex";
import * as pi from "./pi";
import { exists, unique } from "./files";

const HOME = os.homedir();
const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");
const XDG_DATA_HOME = process.env.XDG_DATA_HOME || path.join(HOME, ".local", "share");
const APPDATA = process.env.APPDATA || "";
const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || "";

interface SourceConfig {
  name: HarnessName;
  defaultPaths: string[];
  pathKey: keyof Pick<CliOptions, "db" | "claude" | "codex" | "pi">;
  parse: (customPath?: string, modelFilter?: string, options?: ParseOptions) => Promise<AgentStats | null> | AgentStats | null;
}

const SOURCES: SourceConfig[] = [
  {
    name: "opencode",
    defaultPaths: compact([
      path.join(XDG_DATA_HOME, "opencode", "opencode.db"),
      path.join(HOME, ".local", "share", "opencode", "opencode.db"),
      path.join(HOME, "Library", "Application Support", "opencode", "opencode.db"),
      path.join(HOME, "Library", "Application Support", "dev.opencode", "opencode.db"),
      APPDATA ? path.join(APPDATA, "opencode", "opencode.db") : "",
    ]),
    pathKey: "db",
    parse: opencode.parse,
  },
  {
    name: "claude",
    defaultPaths: compact([
      CLAUDE_CONFIG_DIR ? CLAUDE_CONFIG_DIR : "",
      path.join(HOME, ".claude"),
      path.join(XDG_CONFIG_HOME, "claude"),
      path.join(XDG_DATA_HOME, "claude"),
      path.join(HOME, "Library", "Application Support", "Claude"),
      path.join(HOME, "Library", "Application Support", "claude"),
      APPDATA ? path.join(APPDATA, "Claude") : "",
      APPDATA ? path.join(APPDATA, "claude") : "",
    ]),
    pathKey: "claude",
    parse: claude.parse,
  },
  {
    name: "codex",
    defaultPaths: compact([
      path.join(HOME, ".codex"),
      path.join(XDG_CONFIG_HOME, "codex"),
      path.join(XDG_DATA_HOME, "codex"),
      path.join(HOME, "Library", "Application Support", "Codex"),
      path.join(HOME, "Library", "Application Support", "codex"),
      APPDATA ? path.join(APPDATA, "Codex") : "",
      APPDATA ? path.join(APPDATA, "codex") : "",
    ]),
    pathKey: "codex",
    parse: (customPath?: string, modelFilter?: string, options?: ParseOptions) => codex.parse(customPath, undefined, modelFilter, options),
  },
  {
    name: "pi",
    defaultPaths: compact([
      path.join(HOME, ".pi", "agent", "sessions"),
      path.join(HOME, ".pi", "sessions"),
      path.join(XDG_DATA_HOME, "pi", "agent", "sessions"),
      path.join(XDG_DATA_HOME, "pi", "sessions"),
      path.join(XDG_CONFIG_HOME, "pi", "agent", "sessions"),
      path.join(HOME, "Library", "Application Support", "Pi", "agent", "sessions"),
      path.join(HOME, "Library", "Application Support", "pi", "agent", "sessions"),
      APPDATA ? path.join(APPDATA, "Pi", "agent", "sessions") : "",
      APPDATA ? path.join(APPDATA, "pi", "agent", "sessions") : "",
    ]),
    pathKey: "pi",
    parse: pi.parse,
  },
];

export async function collectAll(options: CliOptions = {}): Promise<AgentStats[]> {
  const verbose = options.verbose || false;
  const filterSet = options.agent
    ? new Set(options.agent.split(",").map((s) => s.trim().toLowerCase()))
    : null;
  const plannedSources: Array<{ source: SourceConfig; resolvedPath: string }> = [];

  for (const source of SOURCES) {
    if (filterSet && !filterSet.has(source.name)) {
      if (verbose) console.error(`[${source.name}] skipped (filtered out by --agent)`);
      continue;
    }

    const customPath = options[source.pathKey];
    const resolvedPath = customPath || firstExisting(source.defaultPaths);

    if (!resolvedPath) {
      if (verbose) console.error(`[${source.name}] no data found at: ${source.defaultPaths.join(", ")}`);
      continue;
    }

    if (verbose) console.error(`[${source.name}] using path: ${resolvedPath}${customPath ? " (custom)" : " (auto-detected)"}`);
    plannedSources.push({ source, resolvedPath });
  }

  const parseOptions: ParseOptions = { by: options.by, json: options.json };
  const parsed = await Promise.all(
    plannedSources.map(({ source, resolvedPath }) => source.parse(resolvedPath, options.model, parseOptions))
  );

  const agents: AgentStats[] = [];
  for (let i = 0; i < plannedSources.length; i++) {
    const stats = parsed[i];
    if (stats) {
      agents.push(stats);
    } else if (verbose) {
      console.error(`[${plannedSources[i].source.name}] path exists but parsing returned no data`);
    }
  }

  return agents;
}

function firstExisting(paths: string[]): string | null {
  return paths.find(exists) || null;
}

function compact(values: string[]): string[] {
  return unique(values.filter(Boolean));
}
