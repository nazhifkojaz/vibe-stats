# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-25

### Added

- **`--color` / `--no-color` CLI flags** to force-enable or disable ANSI color
  output. Useful for forcing color on for non-TTY pagers (`vibe-o-meter --color
  | less -R`) or disabling it explicitly.

### Changed

- **Color output now respects terminal context.** Previously ANSI escapes were
  emitted unconditionally, producing escape-code soup when piped or redirected.
  Color is now auto-disabled when stdout is not a TTY, and the de-facto standard
  `NO_COLOR` / `FORCE_COLOR` environment variables are honored (precedence:
  `--no-color`/`--color` > `FORCE_COLOR` > `NO_COLOR` > TTY detection). The
  update-available warning on stderr is also gated to interactive terminals only.

- **Claude Code: stats-cache and live transcripts are now merged by date instead
  of picking the source with the larger total.** Claude Code stopped updating
  `stats-cache.json`, so recent usage lived only in the per-session JSONL
  transcripts while the frozen (but larger, cumulative) cache hid it. The parser
  now takes JSONL for any date it covers and backfills older, pruned-from-disk
  dates from the cache. The cache's lifetime model/cost/session/hourly
  aggregates are scaled by the fraction of cache daily tokens that survive the
  date merge, so **older Claude per-model and cost totals are now estimates**
  (the cache stores no per-date model breakdown). `--by project` for Claude
  reflects on-disk transcripts only, since the cache carries no project
  breakdown.

### Fixed

- **Heatmap: month labels and week columns are now placed correctly across all
  timezones.** Two bugs were fixed in `heatmap.ts`: (1) month-header detection
  parsed `YYYY-MM-DD` as UTC then read local day-of-month, placing labels in the
  wrong column under negative-UTC-offset zones; (2) week bucketing divided
  elapsed milliseconds by a fixed 7-day span, which mis-buckets days near a DST
  transition where a local week is not exactly 7×86,400,000 ms. UTC output is
  unchanged; only DST-observing zones are affected (now correct).

- **Claude Code: duplicate assistant messages in resumed/forked sessions are now
  deduped by uuid.** Resuming or forking a session copies earlier assistant
  messages verbatim into the new session's file, which previously inflated
  token/turn counts. Messages sharing a `uuid` across files are now counted
  once.
