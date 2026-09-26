<img src="logo.svg" height="48" alt="" />

# Cordenar

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/cordenar.svg)](https://www.npmjs.com/package/cordenar)
[![GitHub](https://img.shields.io/badge/GitHub-cordenar%2Fcordenar-blue)](https://github.com/cordenar/cordenar)
[![Website](https://img.shields.io/badge/website-cordenar.com-blue)](https://cordenar.com)

The shared brain for teams of humans and AI.

Cordenar stores **memories** (facts, decisions, bugs, plans, notes, summaries) and **concepts** (skills, agents, instructions, references) locally in SQLite, with FTS5 full-text search and vec0 vector embeddings for hybrid retrieval. Optional cloud sharing synchronizes knowledge across nodes through Supabase-backed team accounts.

- **Local-first** — all retrieval runs against your local `synapses.db`. Zero cloud dependency at query time.
- **Hybrid search** — FTS5 keyword + vec0 semantic, blended with a configurable `alpha`.
- **Full-tree sharing** — sharing a concept distributes its entire family (ancestors, siblings, descendants, dependencies) so shared skills arrive complete.

## Table of Contents

- [Quick Start](#quick-start)
- [MCP Server Setup](#mcp-server-setup)
- [Agent instructions](#agent-instructions)
- [Dashboard](#dashboard)
- [How It Works](#how-it-works)
- [Retrieval](#retrieval)
- [Telemetry](#telemetry)
- [MCP Tools](#mcp-tools)
- [Configuration](#configuration)
- [Security & Privacy](#security--privacy)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [License](#license)

## Quick Start

Requires **Node.js ≥ 22**.

```bash
npm install -g cordenar
```

Start the dashboard:

```bash
cordenar-dashboard
# → http://localhost:3458
```

CLI:

```bash
cordenar-dashboard              # Start the dashboard
cordenar-dashboard stop         # Stop a running instance
cordenar-dashboard restart      # Stop then restart
```

## MCP Server Setup

Register in your MCP host configuration. Works with any host supporting stdio transport — Claude Desktop, Cursor, OpenCode, Windsurf, GitHub Copilot.

**OpenCode** (`opencode.json`):

```json
{
  "mcp": {
    "cordenar": {
      "type": "local",
      "command": ["npx", "-y", "cordenar@1.0.0"],
      "enabled": true
    }
  }
}
```

**VS Code / Copilot** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "cordenar": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "cordenar@1.0.0"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "cordenar": {
      "command": "npx",
      "args": ["-y", "cordenar@1.0.0"]
    }
  }
}
```

## Agent instructions

Cordenar ships `CORDENAR.md` — the operating instructions that tell your agent how to use its memory (brief at session start, search before deciding, store what you learn). Load it into your agent's context at **highest priority**, above your harness's own instruction files. Your agent will know where; on MCP hosts the `cordenar` server also exposes it as the `brain` prompt.

### AI-assisted setup

Paste this into your AI assistant:

> Set up Cordenar for me:
> 1. `npm install -g cordenar@1.0.0` (Node ≥22).
> 2. Register the `cordenar` MCP server.
> 3. Load Cordenar's operating instructions (`CORDENAR.md`) at highest priority — above your harness's own instructions.
> 4. Verify with `cordenar_memory_brief`; then ask me for `index.paths` and whether to enable cloud sharing.
> Report what you did and confirm http://localhost:3458.

## Dashboard

Browse, search, and preview your memories and concepts at `http://localhost:3458`.

**Features:** dark/light theme with persistence, WCAG 2.1 AA accessibility, real-time SSE updates, toast notifications, skeleton loading, debounced search, scope toggle (local/team/all), source and status filters, per-synapse kebab menu, markdown preview with relationship navigation, and a tool-usage leaderboard.

The port is configurable via `~/.cordenar/config.json` or `CORDENAR_PORT`.

## How It Works

Cordenar runs as a **self-contained local store** — `~/.cordenar/synapses.db` holds all your knowledge:

```
synapses.db
├── memories          Personal memories (facts, decisions, bugs, plans, notes, summaries)
│   ├── memories_fts  FTS5 full-text index
│   └── memories_vec  vec0 vector embeddings (256-dim)
├── concepts          Personal concepts (skills, agents, instructions, references, …)
│   ├── concepts_fts  FTS5 full-text index
│   └── concepts_vec  vec0 vector embeddings (256-dim)
├── memory_synapses   Team-shared memories (pulled from cloud)
├── concept_synapses  Team-shared concepts (pulled from cloud)
├── synapse_map       Cloud-to-local ID reconciliation
└── tool_calls        Telemetry spans (tool, error type, timestamp, environment)
```

**Personal data** lives in `memories` and `concepts` — full CRUD via MCP tools, read-only via the dashboard.

**Team data** is shared through the cloud bridge: push via `share`, approve in the cloud dashboard, and pull into `memory_synapses`/`concept_synapses` on other nodes. Pulled data is stored locally with FTS5 + vec0 for offline hybrid search.

**Related sharing (full-tree).** A concept is shared as its complete *family* — ancestors + immediate siblings (each with its subtree) + descendants + transitively declared `frontmatter.dependencies` (cycle-safe; dangling deps skipped) — so a shared skill arrives with its references. `unshare` expands the same family; `related` returns it among team-shared concepts. Preview the family before sharing with `concept_family`. Memories are shared as-is (no expansion). Sharing a root concept of a single-tree collection shares the whole collection.

**Indexed concepts** — run `concept_index` to scan configured directories of markdown files, parse frontmatter, derive slugs and types, and index bodies for search.

## Retrieval

Six retrieval tools (`memory_search`, `concept_search`, `memory_list`, `concept_list`, `memory_context`, `concept_search_context`) query across local and team data with a `scope` parameter:

- `scope: 'local'` — local data only
- `scope: 'team'` — pulled cloud data
- `scope: 'all'` (default) — both, merged and sorted

All search uses FTS5 + vec0 hybrid scoring: `final = alpha * vec_score + (1 - alpha) * fts_score`.

## Telemetry

Every MCP tool call is tracked as a lightweight OpenTelemetry span. The `tool_usage` tool returns a terminal-style leaderboard with per-tool counts, share percentages, and success rates.

**No argument values or content is ever captured** — only metadata (tool name, error type on failure, timestamp). All telemetry stays in the local `tool_calls` table with a 30-day auto-purge.

## MCP Tools — 37 total

### Memory (14 tools)

| Tool | Description |
|---|---|
| `memory_store` | Store a memory with FTS5 + vec0 indexing |
| `memory_get` | Get a single memory by project + ID |
| `memory_update` | Update memory; re-index if content changes |
| `memory_search` | Hybrid search across local + team (project, kind, status, scope, alpha) |
| `memory_list` | List memories with project/kind/scope filters |
| `memory_context` | Formatted context string for prompt injection |
| `memory_trash` | Soft-delete (recoverable) |
| `memory_restore` | Restore from trash |
| `memory_purge` | Permanently delete |
| `memory_archive` | Archive (excluded from default queries) |
| `memory_unarchive` | Restore from archive |
| `memory_reassign` | Move memories between projects |
| `memory_brief` | Session-start brief (summary staleness, pending, bugs) |
| `memory_progressive_summary` | Progressive summarization with dual-threshold trigger |

### Projects (4 tools)

| Tool | Description |
|---|---|
| `project_list` | List all project namespaces |
| `project_count` | Count memories by kind per project |
| `project_trash` | Soft-delete all memories in a project |
| `project_purge` | Permanently delete a project |

### Concepts (8 tools)

| Tool | Description |
|---|---|
| `concept_index` | Index markdown files from configured paths |
| `concept_deindex` | Remove concepts by `collection` + `slug`, or by `path` |
| `concept_get` | Get a concept by `collection` + `slug` (with `siblings`, optional dependency resolution) |
| `concept_family` | Preview a concept's full family: `{ancestors, descendants, siblings, family, total}` |
| `concept_context` | Concept body as formatted prompt-injection text |
| `concept_search` | Hybrid search across local + team (collection, type, tags, status, match, weights, boost, alpha) |
| `concept_list` | List concepts with collection/type/tags/scope filters |
| `concept_search_context` | Query-based context string from search results |

### Detail (2 tools)

| Tool | Description |
|---|---|
| `get` | Get a full synapse by cloud UUID |
| `related` | Resolve related memories (by `related_ids`) or a team-shared concept's full family |

### Team / Cloud (8 tools)

| Tool | Description |
|---|---|
| `auth` | Authenticate node with cloud (3 modes: list, switch, register) |
| `deauth` | Remove local auth credentials |
| `status` | Auth state, node info, synapse counts, sync timestamps |
| `share` | Push local memories/concepts to cloud; a concept expands to its full family |
| `pull` | Fetch approved synapses from all team accounts |
| `sync` | Full bidirectional sync across nodes |
| `unshare` | Request admin review to retract a shared synapse (full-family) |
| `list_accounts` | List Basejump team accounts |

### Telemetry (1 tool)

| Tool | Description |
|---|---|
| `tool_usage` | Leaderboard: per-tool counts, share percentages, success rates (24hr/7d/30d/all) |

## Configuration

Cordenar uses a single config file at `~/.cordenar/config.json` (created automatically on first run). All keys are optional; defaults are shown.

```json
{
  "port": 3458,
  "dbPath": "~/.cordenar/synapses.db",
  "authFile": "~/.cordenar/auth.json",
  "cloudUrl": "http://127.0.0.1:3459",
  "supabaseUrl": "",
  "supabasePublishableKey": "",
  "backup": {
    "dir": "~/.cordenar/backups",
    "intervalWrites": 50,
    "retention": { "recentHours": 24, "dailyDays": 30, "weeklyWeeks": 12, "monthlyMonths": 12 }
  },
  "summary": { "turnThreshold": 10, "contextThreshold": 20, "recentLimit": 50 },
  "search": { "alpha": 0.3 },
  "index": { "paths": ["/home/user/skills", "/home/user/docs"] }
}
```

Advanced settings (content size limits, busy timeout, retention, kind/type schemas) also live in `config.json` — see `config.js` for the full default set.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CORDENAR_PORT` | `3458` | Dashboard HTTP port |
| `CORDENAR_DB_PATH` | `~/.cordenar/synapses.db` | SQLite database path |
| `CORDENAR_AUTH_FILE` | `~/.cordenar/auth.json` | Multi-node auth credentials |
| `CORDENAR_MANIFEST_PATH` | `~/.cordenar/manifest.json` | Concept index manifest |
| `CORDENAR_ENV` | — | `test` suppresses volatile-path guards |
| `CORDENAR_INDEX_PATHS` | — | Comma-separated concept index paths |
| `CORDENAR_CLOUD_URL` | `http://127.0.0.1:3459` | Cloud dashboard server URL |
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | — | Supabase publishable key |
| `BACKUP_DIR` | `~/.cordenar/backups` | Backup directory |
| `BACKUP_INTERVAL_WRITES` | `50` | Writes between automatic backups |
| `BACKUP_RETENTION_RECENT_HOURS` | `24` | Keep all backups within this many hours |
| `BACKUP_RETENTION_DAILY_DAYS` | `30` | Keep newest backup per day, for N days |
| `BACKUP_RETENTION_WEEKLY_WEEKS` | `12` | Keep newest backup per week, for N weeks |
| `BACKUP_RETENTION_MONTHLY_MONTHS` | `12` | Keep newest backup per month, for N months |
| `CORDENAR_BACKUP_FRESHNESS_HOURS` | `1` | Startup backup if latest is older than N hours |
| `CORDENAR_CONTENT_MAX_SIZE` | `100000` | Max content size (bytes) |
| `CORDENAR_TOOL_RETENTION_DAYS` | `30` | Days to retain `tool_calls` telemetry |
| `CORDENAR_SUMMARY_TURN_THRESHOLD` | `10` | Turns since last summary to trigger refresh |
| `CORDENAR_SUMMARY_CONTEXT_THRESHOLD` | `20` | Context-remaining % to trigger refresh |
| `CORDENAR_DB_BUSY_TIMEOUT` | `5000` | SQLite busy timeout (ms) |

`CORDENAR_INDEX_PATHS` accepts a comma-separated list of scan paths. Collection is derived per file from the bundle root (nearest `.git` / `package.json` / `SKILL.md`), not configured.

## Security & Privacy

- **Local-first** — memories and concepts live in `~/.cordenar/synapses.db` on your machine. Nothing leaves it unless you explicitly `share` to a team account.
- **No content in telemetry** — spans capture only tool name, error type, and timestamp. Argument values and content are never recorded.
- **Localhost-only dashboard** — the dashboard binds `127.0.0.1`, not the LAN.
- **Opt-in cloud** — cloud sharing requires explicit `auth` + `share`; an admin approves every synapse before it reaches other nodes.
- **Credentials** — node JWTs are stored in `~/.cordenar/auth.json`; Supabase secrets are never logged or returned in tool responses.

## Documentation

Full ISO-aligned documentation lives in the [`docs/`](https://github.com/cordenar/cordenar/tree/main/docs) directory:

- [Documentation index](https://github.com/cordenar/cordenar/blob/main/docs/index.md) — feature catalog (SRS + Architecture + Developer Docs per feature)
- [System Architecture](https://github.com/cordenar/cordenar/blob/main/docs/architecture.md) — context/container views, system ADRs
- [Platform Operations](https://github.com/cordenar/cordenar/blob/main/docs/platform.md) — environment variables, MCP conventions, deployment

Each feature ships a Software Requirements Specification (ISO 29148), Architecture Description (ISO 42010), and Developer Documentation (ISO 26514).

## Roadmap

### Consider

- Import/export for memories (JSON, Markdown)
- Team-level progressive summaries
- CLI for quick memory capture
- OTLP export for cloud telemetry

## License

[MIT](./LICENSE)
