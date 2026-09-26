---
type: DeveloperReference
title: Developer Documentation: Dashboard
description: Developer reference and tool documentation for the dashboard feature of Cordenar MCP.
tags: [dashboard, developer, api]
timestamp: 2026-09-25T00:00:00Z
---

# Developer Documentation: Dashboard

**Standard:** ISO/IEC/IEEE 26514:2022

## Overview

The local web dashboard at `localhost:3458` provides a UI for browsing memories and concepts. It uses Basecoat components, Tailwind v4 CDN, and 5 ES modules for frontend logic.

## API Reference

### GET /health
**Returns:** `{ version, uptime, db_size, backup_count }`. Top-level (not under `/api`). Used by tests for smoke checks.

### GET /api/dashboard
**Query params:** scope (all/local/team), source (memory/concept), search, collection, status, kind, project, memstatus, lifecycle (active/archived/trash), conType, conStatus, limit, offset.
**Returns:** `{ rows: [...], total, limit, offset }`.

### GET /api/projects
**Returns:** Array of distinct project namespaces.

### GET /api/status
**Returns:** Node auth state — active node, pending push count, un-pulled count, last sync time.

### GET /api/stats
**Returns:** Aggregate: `{ total, memoryCount, conceptCount, teamTotal, sharedCount, pulledCount, kinds, types, statuses, teamSync, nodes, teams, ... }`.

### GET /api/tool-stats
**Query params:** period (24h/7d/30d/all). **Returns:** Tool usage leaderboard — per-tool counts, share percentages, success rates.

### GET /api/memories/:id
**Query params:** project. **Returns:** Full local memory content + metadata.

### GET /api/collections
**Returns:** Array of collection namespaces — union of local `concepts.collection` and team `concept_synapses.collection`.

### GET /api/synapses/:id
**Query params:** source (memory|concept). **Returns:** Full local synapse detail (memory or concept) with relations.

### GET /api/events
**Returns:** SSE stream. Events include memory_new, synapse_updated, index_complete.

### POST /api/sync
**Trigger:** Starts cloud sync. Returns sync result.

### POST /api/notify
**Internal.** Broadcasts an SSE event to all connected dashboard clients. Called by the MCP server on mutations.

### Kebab-menu actions (POST /api/synapses/:id/*)

Each maps to a `sync` operation (see `docs/sync/`):

| Route | Sync operation | Purpose |
|---|---|---|
| `/share` | `shareSynapses` | Push a single synapse to cloud |
| `/unlink` | `fullSync` unlink | Remove a locally-deleted shared synapse |
| `/unshare` | `unshareSynapse` | Request admin review to retract a shared synapse |
| `/pull-delete` | local delete | Remove a pulled team synapse from local store |
| `/dismiss` | local delete | Dismiss a pending/rejected synapse |

## Frontend Modules

| Module | File | Responsibility |
|---|---|---|
| state.js | src/state.js | Global state, DOM helpers, constants, syncThemeBtn |
| ui.js | src/ui.js | Render (table rows, preview, dropdowns, modals) |
| api.js | src/api.js | fetch wrappers for /api/* routes |
| events.js | src/events.js | Event bindings, filter handlers, SSE setup |
| main.js | src/main.js | Entry point — initEvents, loadSynapses |

## Development

No build step. Edit `dashboard/public/index.html` + `src/*.js` and refresh. Dashboard runs as a child process of the MCP server via `dashboard.js`.

## Document Control
- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./dashboard-srs.md)
- [Architecture](./dashboard-architecture.md)
- [System Architecture](../architecture.md)
