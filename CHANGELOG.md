# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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

- **Claude Code: duplicate assistant messages in resumed/forked sessions are now
  deduped by uuid.** Resuming or forking a session copies earlier assistant
  messages verbatim into the new session's file, which previously inflated
  token/turn counts. Messages sharing a `uuid` across files are now counted
  once.
