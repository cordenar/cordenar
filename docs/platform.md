---
type: Reference
title: Platform Operations — Cordenar MCP
description: Platform operations, environment variables, and MCP conventions.
tags: [cordenar, platform, operations]
timestamp: 2026-09-25T00:00:00Z
---

# Platform Operations — Cordenar MCP

Operational cross-cutting concerns, environment configuration, MCP conventions, and deployment guide for the Cordenar MCP server.

## Deliverables Map

| Deliverable | Entry Point | Description |
|---|---|---|
| `cordenar` (MCP server) | `index.js` | MCP stdio server — 36 tools, local SQLite, cloud sync |
| `cordenar-dashboard` (dashboard) | `dashboard.js` | HTTP web dashboard at `localhost:3458` |
| `cordenar` (npm package) | `package.json` | `npm install -g cordenar` — both binaries in PATH |

## Environment Variables

All variables have defaults in `config.js`. Override via environment.

### Server

| Variable | Default | Description |
|---|---|---|
| `CORDENAR_PORT` | `3458` | Dashboard HTTP port |
| `CORDENAR_DB_PATH` | `~/.cordenar/synapses.db` | SQLite database path |
| `CORDENAR_AUTH_FILE` | `~/.cordenar/auth.json` | Multi-node auth credentials |
| `CORDENAR_MANIFEST_PATH` | `~/.cordenar/manifest.json` | Concept index manifest |
| `CORDENAR_ENV` | — | Set to `test` to suppress volatile-path guards |
| `CORDENAR_INDEX_PATHS` | — | Comma-separated paths for concept indexing |

### Cloud Sync

| Variable | Default | Description |
|---|---|---|
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | — | Supabase anon/publishable key |
| `CORDENAR_CLOUD_URL` | `http://127.0.0.1:3459` | Cloud dashboard server URL |

### Backup

| Variable | Default | Description |
|---|---|---|
| `BACKUP_DIR` | `~/.cordenar/backups` | Backup directory |
| `BACKUP_INTERVAL_WRITES` | `50` | Write-count threshold before triggering a backup |
| `BACKUP_RETENTION_RECENT_HOURS` | `24` | Keep all backups within this many hours |
| `BACKUP_RETENTION_DAILY_DAYS` | `30` | Keep newest backup per day for this many days |
| `BACKUP_RETENTION_WEEKLY_WEEKS` | `12` | Keep newest backup per week for this many weeks |
| `BACKUP_RETENTION_MONTHLY_MONTHS` | `12` | Keep newest backup per month for this many months |
| `CORDENAR_BACKUP_FRESHNESS_HOURS` | `1` | Run backup on startup if latest is older than this |

### Content Limits

| Variable | Default | Description |
|---|---|---|
| `CORDENAR_CONTENT_MAX_SIZE` | `100000` | Maximum content size in bytes |
| `CORDENAR_TOOL_RETENTION_DAYS` | `30` | Days to retain tool_calls telemetry |

### Summary Thresholds

| Variable | Default | Description |
|---|---|---|
| `CORDENAR_SUMMARY_TURN_THRESHOLD` | `10` | Turns since last summary to trigger refresh |
| `CORDENAR_SUMMARY_CONTEXT_THRESHOLD` | `20` | Context remaining percent to trigger refresh |

### Database

| Variable | Default | Description |
|---|---|---|
| `CORDENAR_DB_BUSY_TIMEOUT` | `5000` | SQLite busy timeout in milliseconds |

## MCP Conventions

### Tool Registration Pattern

All 36 tools follow this pattern in `server.js`:

```js
server.registerTool('tool_name', {
  description: 'Human-readable description of what the tool does.',
  inputSchema: z.object({
    param_name: z.string().describe('Parameter description'),
    // ...
  }),
}, withTelemetry('tool_name', async (args) => {
  // handler logic
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}));
```

Key conventions:
- Tool names use `snake_case` with a domain prefix: `memory_*`, `concept_*`, `project_*`.
- `withTelemetry()` wraps every handler — creates an OTel span, records to `tool_calls`.
- Input validation via Zod `inputSchema`. Every param has a `.describe()` for the MCP spec.
- Results returned as JSON strings via `{ content: [{ type: 'text', text: ... }] }`.

### MCP Prompt

Cordenar registers an MCP prompt (`brain`) that serves `CORDENAR.md` as an agent-facing instruction set.

## Autonomy Stack

Cordenar's autonomy instructions live in `CORDENAR.md` and are injected into every AI agent session as the `brain` MCP prompt. They define:

- **Session lifecycle contract** — agents must run `memory_brief` at session start, store facts/decisions/bugs autonomously, and run `memory_progressive_summary` after significant multi-turn work.
- **Decision support** — agents must search memory (`memory_search`) before architectural decisions.
- **Discovery cascade** — agents must search Cordenar concepts before tasks, then check local convention files.
- **Error recovery** — specific actions for tool failures, empty searches, and authentication errors.

The `_autonomy_rules` field injected into every `memory_brief` response directs agents to operate with Cordenar persistent memory.

## Build and Deploy

### Development

```bash
npm install                                  # install dependencies
npm test                                     # run 104 tests (4 Cloud Tier 1 skipped)
cordenar-dashboard                           # start dashboard at :3458
```

### Production

```bash
npm install -g /path/to/cordenar             # global install from local source
cordenar                                     # MCP server (via MCP host)
cordenar-dashboard                           # dashboard (standalone)
```

### systemd (optional)

```bash
cp cordenar.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable cordenar
systemctl --user start cordenar
```

The service restarts on crash (`Restart=always`, `RestartSec=5`), logs to journald, and auto-starts on user login.

### Scripts

```bash
npm run backfill-embeddings                 # backfill Murmur3 embeddings for existing synapses
```

`scripts/backfill-embeddings.js` is a standalone, idempotent script that recomputes embeddings for the active node's own rows (filtered by `source_node_id`), in 500-row batches. Used to repopulate vec0 vectors after schema changes or for nodes that predate local embedding.

## Config File Format

`~/.cordenar/config.json` deep-merges into `config.js` defaults. Environment variables take precedence over both.

Priority chain: **env vars > config.json > DEFAULTS**

```json
{
  "supabaseUrl": "http://localhost:54321",
  "supabasePublishableKey": "sb_publishable_...",
  "index": { "paths": ["/home/user/skills"] },
  "backup": {
    "dir": "~/.cordenar/backups",
    "intervalWrites": 50,
    "retention": {
      "recentHours": 24,
      "dailyDays": 30,
      "weeklyWeeks": 12,
      "monthlyMonths": 12
    }
  }
}
```

All keys are optional — defaults fill in anything missing via `deepMerge`.

## System-Level Risks

| Risk ID | Description | Impact | Mitigation |
|---|---|---|---|
| R-01 | DB corruption from process kill | High — data loss | Hourly backups with VACUUM INTO + verifyBackup |
| R-02 | Hostile MCP client calls destructive tools | Med — data integrity | MCP host is the security boundary; Cordenar tools trust the caller |
| R-03 | Cloud sync URL not reachable | Low — sync disabled | Graceful error; system operates fully offline |
| R-04 | sqlite-vec extension missing | Low — vec0 disabled | VEC_AVAILABLE flag; FTS5-only fallback |
| R-05 | Token expiry blocking cloud sync | Med — sync stale | Token refresh in supabase.js; `needs_reauth` flag |

## Controlled Vocabulary

| Type | Use when |
|---|---|
| `Specification` | Software Requirements Specification (SRS) under ISO 29148 |
| `Architecture` | Architecture Description, ADRs, design views under ISO 42010 |
| `DeveloperReference` | API reference, developer documentation, integration guides under ISO 26514 |
| `Reference` | Curated reference material, platform operations, cross-cutting concerns |

## Related

- [System Architecture](./architecture.md)
- [Documentation Index](./index.md)
