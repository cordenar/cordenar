# Changelog

All notable changes to Cordenar are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
