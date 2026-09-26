---
type: Specification
title: Software Requirements Specification (SRS): Dashboard
description: Software requirements for the dashboard feature of Cordenar MCP.
tags: [dashboard, specification, requirements]
timestamp: 2026-09-25T00:00:00Z
---

# Software Requirements Specification (SRS): Dashboard

**Standard:** ISO/IEC/IEEE 29148:2018

## 1. Introduction

The local web dashboard at `localhost:3458` provides a browsing and management UI for Cordenar memories and concepts.

### 3.1 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | The dashboard HTTP server MUST listen on `CORDENAR_PORT` (default 3458) and serve static files from `dashboard/public/`. | Must |
| FR-02 | The dashboard MUST provide `GET /api/dashboard` returning paginated synapses with filter parameters (scope, source, collection, status, search, kind, project, memstatus, lifecycle, conType, conStatus, limit, offset). | Must |
| FR-03 | The dashboard MUST provide `GET /api/dashboard?scope=team` returning cloud-synced synapses. | Must |
| FR-04 | The dashboard MUST provide `GET /api/stats` returning aggregate counts (`total`, `memoryCount`, `conceptCount`, `teamTotal`, `sharedCount`, `pulledCount`, per-kind/type/status distributions, per-team sync). | Must |
| FR-05 | The dashboard MUST provide `GET /api/synapses/:id` returning full synapse detail. | Must |
| FR-06 | The dashboard MUST provide `GET /api/memories/:id?project=X` returning full memory content. | Must |
| FR-07 | The dashboard MUST provide `GET /api/collections` returning the union of local and team concept collections. | Must |
| FR-08 | The dashboard MUST provide `POST /api/sync` triggering a full cloud sync. | Must |
| FR-09 | The software MUST broadcast SSE events on memory/concept mutations (memory_new, memory_update, memory_trash, etc.) to all connected dashboard clients. | Must |
| FR-10 | The dashboard UI MUST support: synapse table with pagination, memory/concept detail modal with related/referenced navigation, scope toggle (all/local/team), source filter (memory/concept), collection filter, search, sort, preview modal with markdown rendering, tool usage leaderboard. | Must |

### 3.4 Interfaces

**HTTP API routes:**
| Route | Method | Purpose |
|---|---|---|
| / | GET | Static dashboard UI |
| /health | GET | Health check with version, uptime, db_size, backup_count |
| /api/dashboard | GET | Paginated synapse list with filters |
| /api/projects | GET | List project namespaces |
| /api/status | GET | Node auth state |
| /api/stats | GET | Aggregate counts |
| /api/tool-stats | GET | Tool usage leaderboard (period: 24h/7d/30d/all) |
| /api/memories/:id | GET | Memory detail (query: project) |
| /api/collections | GET | Union of local + team concept collections |
| /api/synapses/:id | GET | Synapse detail (query: source=memory|concept) |
| /api/synapses/:id/share | POST | Kebab: push synapse to cloud |
| /api/synapses/:id/unlink | POST | Kebab: unlink locally-deleted shared synapse |
| /api/synapses/:id/unshare | POST | Kebab: request unshare (governance) |
| /api/synapses/:id/pull-delete | POST | Kebab: remove pulled team synapse |
| /api/synapses/:id/dismiss | POST | Kebab: dismiss pending/rejected synapse |
| /api/sync | POST | Trigger sync |
| /api/notify | POST | SSE event broadcast (internal) |
| /api/events | GET | SSE stream |

### 3.8 Data Management

Dashboard is stateless — all data reads from the MCP backend (synapses.db). UI state is session-only.

## Related

- [Architecture](./dashboard-architecture.md)
- [Developer Documentation](./dashboard-developer-documentation.md)
- [System Architecture](../architecture.md)
