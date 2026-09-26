---
type: Specification
title: Software Requirements Specification (SRS): Memory
description: Software requirements for the memory feature of Cordenar MCP.
tags: [memory, specification, requirements]
timestamp: 2026-09-25T00:00:00Z
---

# Software Requirements Specification (SRS): Memory

**Standard:** ISO/IEC/IEEE 29148:2018

## Document Information

| Field | Value |
|---|---|
| Project | Cordenar MCP |
| Software Component | Memory — local memory store, lifecycle, and retrieval |
| Version | 1.0 — Draft |
| Date | 2026-09-25 |
| Author | Hector Jarquin |
| StRS Reference | N/A — direct brief |
| SyRS Reference | N/A — SRS produced directly from feature scope |
| Status | Draft |

---

## 1. Introduction

### 1.1 System Purpose

The Memory feature is the core knowledge store of Cordenar. It persists **memories** (facts, decisions, bugs, plans, notes, progressive summaries) in a local SQLite database with FTS5+vec0 hybrid search, lifecycle management (active/archived/trash/purge), project scoping, retrieval for AI agent context windows, and cloud sync.

### 1.2 System Scope

**Software identifier:** `cordenar`

**Repository path:** `/home/hector/cordenar` (server.js → `memory_*` tools, db.js → memories table)

### 1.3 System Overview

#### 1.3.1 System Context

The Memory feature provides the 14 `memory_*` MCP tools exposed to AI agents via stdio. Memories are stored in the `memories` table of `synapses.db`, backed up hourly with VACUUM INTO, and optionally shared to Cordenar Cloud.

#### 1.3.2 System Functions Summary

- **Store and retrieve** memories by project and ID
- **Update** content, kind, metadata, or related IDs (re-indexes FTS5+vec0)
- **Lifecycle**: trash (soft-delete), restore, purge (permanent), archive (exclude from default), unarchive
- **Search**: hybrid FTS5+vec0 with configurable alpha blending
- **List/Browse**: paginated listing with project, kind, status, and scope filters
- **Context injection**: formatted prompt-context string for AI agent consumption
- **Brief**: lightweight project metadata summary at session start
- **Progressive summary**: dual-threshold context summary generation
- **Reassign**: move memories between projects

#### 1.3.3 User Characteristics

| User Class | Technical Level | Primary Interaction |
|---|---|---|
| AI agent (MCP consumer) | N/A (automated) | memory_search, memory_store, memory_brief, memory_progressive_summary |
| Human user (dashboard) | Technical | Browse, inspect, manage lifecycle |

### 1.4 Definitions

| Term | Definition |
|---|---|
| Memory | A stored knowledge unit (fact, decision, bug, plan, note, summary) with content, metadata, lifecycle status |
| Lifecycle | The state machine governing a memory: active → archived / trash → purged |
| FTS5 | SQLite Full-Text Search — keyword indexing |
| vec0 | sqlite-vec vector search — embedding similarity |
| Alpha | Blend weight between FTS5 score and vec0 score (0 = FTS5 only, 1 = vec0 only) |
| Brief | Lightweight metadata overview of projects (stale status, pending counts, open bugs) |

---

## 2. References

- ISO/IEC/IEEE 29148:2018 — Software Requirements Specification
- MCP Specification — https://modelcontextprotocol.io/
- better-sqlite3 — https://github.com/WiseLibs/better-sqlite3
- sqlite-vec — https://github.com/asg017/sqlite-vec
- Cordenar docs/architecture.md — system ADRs (SAD-01, SAD-04, SAD-05)

---

## 3. Software Requirements

**Notation:** `MUST` = mandatory. `SHOULD` = strongly desired. `MAY` = optional.

Each requirement has a unique ID: `FR-XX`.

---

### 3.1 Functional Requirements

#### 3.1.1 Retrieval

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | The software MUST execute `memory_search` with hybrid FTS5+vec0 retrieval. Accepts query, optional project/kind/status/scope/cloud_status/limit/offset/alpha filters. Returns ranked results with FTS score, vec score, and blended score. | Must |
| FR-02 | The software MUST execute `memory_list` with paginated listing. Accepts optional project/kind/scope/cloud_status/limit filters. Returns local and team memories. | Must |
| FR-03 | The software MUST execute `memory_context` returning a formatted context string for prompt injection. Accepts query, optional project/scope/limit. Returns raw text (not JSON) suitable for LLM context windows. | Must |

#### 3.1.2 CRUD

| ID | Requirement | Priority |
|---|---|---|
| FR-04 | The software MUST execute `memory_store` to persist a new memory. Accepts project, content (required), kind (optional, default 'note'), related_ids, status, and metadata. Must re-index FTS5 and vec0 on insert. Must return the new memory ID. | Must |
| FR-05 | The software MUST execute `memory_get` to retrieve a single memory by project and ID. Returns full row with parsed metadata and related_ids. Must throw an error if not found. | Must |
| FR-06 | The software MUST execute `memory_update` to modify an existing memory. Accepts id, project (required), and optional kind/content/metadata/related_ids/status. Must re-index FTS5 and vec0 if content changes. Must return update success status. | Must |

#### 3.1.3 Lifecycle

| ID | Requirement | Priority |
|---|---|---|
| FR-07 | The software MUST execute `memory_trash` to soft-delete a memory. The memory remains in the database with a `trash` lifecycle status. Must be recoverable via `memory_restore`. | Must |
| FR-08 | The software MUST execute `memory_restore` to recover a trashed memory back to active. Must return restore success status. | Must |
| FR-09 | The software MUST execute `memory_purge` to permanently delete a memory. By default requires the memory to be in trash first unless `force=true`. Must remove the row and its FTS5/vec0 entries. | Must |
| FR-10 | The software MUST execute `memory_archive` to archive a memory. Archived memories are excluded from default list/search/context results. | Must |
| FR-11 | The software MUST execute `memory_unarchive` to restore an archived memory to active. | Must |

#### 3.1.4 Project Operations

| ID | Requirement | Priority |
|---|---|---|
| FR-12 | The software MUST execute `memory_reassign` to move memories between projects. If `ids` are provided, moves only those specific IDs. If omitted, moves all memories from `from_project` to `to_project`. Must notify the dashboard via SSE. | Must |

#### 3.1.5 AI Autonomy

| ID | Requirement | Priority |
|---|---|---|
| FR-13 | The software MUST execute `memory_brief` at agent session start. Returns lightweight metadata per project: last summary staleness, pending counts, open bug counts, activity counts. Must inject `_autonomy_rules` directive into every brief response. | Must |
| FR-14 | The software MUST execute `memory_progressive_summary` to assess whether a new summary is needed. Uses dual-threshold trigger: context pressure ≤20% OR ≥10 turns since last summary. Returns the freshest existing summary if still current, or structured data for a new summary. | Must |

---

### 3.4 Software Interfaces

#### 3.4.1 MCP Tool Contracts

Each `memory_*` tool is registered via `server.registerTool()` with a Zod `inputSchema` and `withTelemetry` wrapper. All tools run locally with zero cloud dependency.

| Tool | Input (required) | Input (optional) | Output |
|---|---|---|---|
| memory_search | query (string) | project, kind, status, scope, cloud_status, limit, offset, alpha | Ranked results with scores |
| memory_list | — | project, kind, scope, cloud_status, limit | Paginated memory list |
| memory_context | query (string) | project, scope, limit | Formatted text string |
| memory_store | project (string), content (string) | kind, related_ids (number[]), status, metadata (object) | `{ id, success }` |
| memory_get | project (string), id (number) | — | Full memory row |
| memory_update | id (number), project (string) | kind, content, metadata, related_ids, status | `{ updated: boolean }` |
| memory_trash | project (string), id (number) | — | `{ deleted: boolean }` |
| memory_restore | project (string), id (number) | — | `{ restored: boolean }` |
| memory_purge | project (string), id (number) | force (boolean) | `{ purged: boolean }` |
| memory_archive | project (string), id (number) | — | `{ archived: boolean }` |
| memory_unarchive | project (string), id (number) | — | `{ unarchived: boolean }` |
| memory_reassign | from_project (string), to_project (string) | ids (number[]) | `{ moved: number }` |
| memory_brief | — | project (string) | Brief metadata per project + `_autonomy_rules` |
| memory_progressive_summary | project (string) | turns_since_last (number), context_remaining_pct (number) | Summary data or existing summary |

#### 3.4.2 Dashboard HTTP API

Mutations to memories broadcast SSE events to the dashboard at `localhost:3458`. Events include: `memory_new`, `memory_update`, `memory_trash`, `memory_restore`, `memory_purge`, `memory_archive`, `memory_unarchive`, `memory_reassign`. The dashboard API also serves `GET /api/memories/:id` for detail views.

---

### 3.5 Software Operations

**Memory write flow:**
```
MCP Client → memory_store → server.js → withTelemetry span →
  Zod validate → storeMemory(args) → db.js INSERT → FTS5 INSERT → vec0 INSERT →
  notifyDash('memory_new') → return { id, success }
```

**Memory search flow:**
```
MCP Client → memory_search → server.js →
  memorySearch(query, filters) → vec0(alpha × vec_score) + FTS5((1-alpha) × fts_score) →
  blend → return ranked results
```

**Lifecycle transitions:**
```
active ↔ archived (memory_archive / memory_unarchive)
active → trash (memory_trash)
trash → active (memory_restore)
trash → purged (memory_purge, memory_purge force bypass)
```

---

### 3.6 Software Modes and States

| State | Entry Trigger | Exit Trigger | Behavior |
|---|---|---|---|
| active | store (default) | trash, archive | Included in default search/list/context |
| archived | archive | unarchive | Excluded from default search/list/context; explicitly filterable by `scope=archived` |
| trash | trash | restore, purge | Hidden from default views; recoverable; purge-eligible |
| purged | purge | N/A | Row permanently deleted |

---

### 3.7 Security Requirements

| ID | Requirement |
|---|---|
| SEC-01 | All user-supplied content MUST be stored as text without server-side sanitization and escaped on output in the dashboard to prevent XSS. |
| SEC-02 | Memory operations MUST NOT require authentication (local-first tool). Cloud sharing is authenticated separately via the auth module. |
| SEC-03 | Project scoping MUST prevent cross-project data access in memory_get/memory_update/memory_trash/memory_restore/memory_purge (scoped by `project` param). |

---

### 3.8 Data Management

| Data Item | Storage | Type | Retention |
|---|---|---|---|
| memories table | synapses.db | SQLite row | Indefinite (until purged) |
| FTS5 index | synapses.db (virtual table) | content-sync | Matches memories table |
| vec0 index | synapses.db (virtual table) | external | Matches memories table |
| metadata JSON | memories.metadata | TEXT (JSON string) | Indefinite |
| related_ids | memories.related_ids | TEXT (JSON array) | Indefinite |

Key columns: `id` (INTEGER PRIMARY KEY), `project` (TEXT), `content` (TEXT), `kind` (TEXT), `status` (TEXT), `metadata` (TEXT JSON), `related_ids` (TEXT JSON array), `created_at` (INTEGER unix), `updated_at` (INTEGER unix).

Indexes: composite on `(project, kind)`, `(project, status)`, `created_at`. FTS5 content-sync on `content`. vec0 on embedding.

---

### 3.9 Compliance and Policies

| Policy | Requirement |
|---|---|
| Code quality | All JS MUST pass `node --check`. Tests MUST pass npm test. |
| Test coverage | 28 tests for auth module (Phase 1), 72+ tests across DB init, CRUD, lifecycle, search (Phase 2). No specific coverage threshold. |
| License | MIT |

---

## 4. Verification and Acceptance

| Requirement Group | Verification Method | Tool |
|---|---|---|
| Functional (FR-01 to FR-14) | Integration tests (test/cordenar.test.mjs) | vitest |
| Lifecycle states | Lifecycle transition tests | vitest |
| Hybrid search | Search ranking assertions (Phase 2 describe block) | vitest |
| SSE notifications | Dashboard test (test/dashboard.test.mjs) | vitest |
| Code quality | Syntax check | node --check |

---

## 5. Traceability

| SRS Requirement ID | Test Reference |
|---|---|
| FR-01 (memory_search) | test/cordenar.test.mjs — search tests |
| FR-02 (memory_list) | test/cordenar.test.mjs — list tests |
| FR-04 (memory_store) | test/cordenar.test.mjs — store tests |
| FR-07 to FR-11 (lifecycle) | test/cordenar.test.mjs — lifecycle tests |
| FR-14 (progressive_summary) | test/cordenar.test.mjs — summary tests |

Full traceability matrix to be completed with specific test case IDs in a future pass.

---

## 6. Appendices

### 6.1 Assumptions and Dependencies

- `sqlite-vec` extension is available at runtime. Gracefully degrades if not (vec0 search disabled).
- AI agents consume `_autonomy_rules` directive from `memory_brief`.
- Cloud sync is optional; memories function fully offline.
- Memory content is sized within `CORDENAR_CONTENT_MAX_SIZE` (default 100,000 bytes).

### 6.2 Open Issues

| ID | Section | Issue | Target |
|---|---|---|---|
| TBD-01 | §3.8 | Full table schema DDL to be documented | Architecture pass |

### 6.3 Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-10 | Use `kind` enum: fact, decision, bug, plan, note, progressive_summary | Derived from Hemisphere precedent |
| 2026-07-10 | Lifecycle states: active, archived, trash (no draft/proposed on store) | Simpler than full workflow; kind-based status defaults |
| 2026-08-01 | ES modules refactor for dashboard (from IIFE) | SAD-08 — proper scoping, bug fixes |

## Related

- [Architecture](./memory-architecture.md)
- [Developer Documentation](./memory-developer-documentation.md)
- [System Architecture](../architecture.md)
