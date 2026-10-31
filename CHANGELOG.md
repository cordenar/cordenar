# Changelog

All notable changes to Cordenar are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-10-31

### Changed

- **Documentation** — README MCP host examples no longer pin a specific version; `npx -y cordenar` resolves to `latest`. Deployment and developer docs now use the `cordenar dashboard` command and the `cordenar.service.example` template.
- **Repository** — removed machine-specific `.gitignore` entries left over from private pre-release development.

### Removed

- `.npmignore` — the `package.json` `files` whitelist is now the single authoritative packaging spec.

## [1.1.0] - 2026-10-29

### Added

- **`cordenar` CLI dispatcher** — a single `cordenar` command with subcommands: bare `cordenar` runs the MCP server, `cordenar dashboard` starts the dashboard and opens it in the browser, plus `--help` and `--version`.
- **Dashboard status line** — `cordenar dashboard` prints memory and concept counts on startup; `/health` now reports `memories` and `concepts`.

### Fixed

- **MCP stdio stdout pollution** — removed a `console.log` from `initDb()` that wrote a non-JSON line to the MCP server's stdout channel; counts are now exposed via a pure `getCounts()`.

### Deprecated

- **`cordenar-dashboard`** — superseded by `cordenar dashboard`; still works but will be removed in 2.0.0.

## [1.0.0] - 2026-09-25

First public release.

### Added

- **Memory** (14 tools) — local-first knowledge store for facts, decisions, bugs, plans, notes, and progressive summaries, with a full lifecycle (trash, restore, purge, archive) and project reassignment.
- **Concepts** (8 tools) — markdown indexer that parses frontmatter and indexes bodies for search, with a full-tree relational model (`family`, `siblings`, `descendants`, `dependencies`).
- **Projects** (4 tools) — namespace management for memories.
- **Hybrid search** — FTS5 keyword + vec0 semantic retrieval with configurable `alpha` blending, `scope` (local/team/all), and title-weighted BM25 field weighting.
- **Cloud sharing** — opt-in team sync through Supabase-backed accounts; a shared concept expands to its **entire family** (ancestors + siblings + descendants + declared dependencies) so shared skills arrive complete.
- **Dashboard** — local web UI at `localhost:3458`: browse, search, markdown preview, SSE updates, dark/light theme, WCAG 2.1 AA.
- **Telemetry** — local OpenTelemetry spans and a `tool_usage` leaderboard; no content is ever captured.
- **Multi-node auth** — authenticate with multiple team accounts and switch the active node.

### Security & Privacy

- Local-first: knowledge lives in `~/.cordenar/synapses.db`; nothing leaves the machine unless explicitly shared.
- Telemetry captures only tool name, error type, and timestamp — never content.
- Dashboard binds `127.0.0.1`.
