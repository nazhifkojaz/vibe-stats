# vibe-o-meter

Terminal tool to visualize AI coding agent usage across OpenCode, Claude Code, Codex, and Pi.

## Usage

Run without installing:

```sh
npx vibe-o-meter
bunx vibe-o-meter
```

Common options:

```sh
vibe-o-meter --agent opencode
vibe-o-meter --agent opencode,claude
vibe-o-meter --model gpt-4o
vibe-o-meter --by model
vibe-o-meter --by project
vibe-o-meter --by hour
vibe-o-meter --weeks 8 --json
vibe-o-meter --verbose
vibe-o-meter --color | less -R
vibe-o-meter --no-color > report.txt
```

Color is auto-enabled on an interactive terminal and auto-disabled when piped or redirected. `NO_COLOR` and `FORCE_COLOR` are honored; `--color` / `--no-color` override both.

`--weeks` controls the calendar-week heatmap range and the summary totals rendered with it. `--week` is accepted as an alias. Range-filtered JSON clears aggregate fields that cannot be accurately narrowed to the selected dates instead of showing stale all-time breakdowns.

## Data Sources

By default, `vibe-o-meter` reads local usage data from:

- OpenCode: `$XDG_DATA_HOME/opencode/opencode.db`, `~/.local/share/opencode/opencode.db`, `~/Library/Application Support/opencode/opencode.db`, or `%APPDATA%/opencode/opencode.db`
- Claude Code: `~/.claude`, `$XDG_CONFIG_HOME/claude`, `$XDG_DATA_HOME/claude`, `~/Library/Application Support/Claude`, or `%APPDATA%/Claude`
- Codex: `~/.codex`, `$XDG_CONFIG_HOME/codex`, `$XDG_DATA_HOME/codex`, `~/Library/Application Support/Codex`, or `%APPDATA%/Codex`
- Pi: `~/.pi/agent/sessions`, `$XDG_DATA_HOME/pi/agent/sessions`, `~/Library/Application Support/Pi/agent/sessions`, or `%APPDATA%/Pi/agent/sessions`

Override paths when needed:

```sh
vibe-o-meter --db /path/to/opencode.db
vibe-o-meter --claude /path/to/stats-cache.json
vibe-o-meter --claude /path/to/.claude/projects
vibe-o-meter --codex /path/to/state_5.sqlite
vibe-o-meter --codex /path/to/.codex/sessions
vibe-o-meter --pi /path/to/sessions
```

## Privacy

This tool reads local files only and does not send usage data over the network.

Human-readable output may include shortened project paths for project breakdowns. JSON output redacts source path parent directories and reduces absolute project paths to their basename to lower accidental local path disclosure risk.

When `--model` is used, token totals are filtered to matching models. If a source does not expose model-specific session, turn, or hourly metadata, those fields are reported as unavailable (`0` or empty arrays) instead of guessed.

## License

MIT
