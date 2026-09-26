---
type: Architecture
title: Architecture Description: Memory
description: Architecture description and ADRs for the memory feature of Cordenar MCP.
tags: [memory, architecture, adr]
timestamp: 2026-09-25T00:00:00Z
---

# Architecture Description: Memory

**Standard:** ISO/IEC/IEEE 42010:2022

## 1. Purpose and Scope

**Purpose:** This document describes the architecture of the Memory feature — the core knowledge store of Cordenar. It covers the memories table design, FTS5+vec0 hybrid search, lifecycle state machine, and SSE-based dashboard notification flow.

**In scope:**
- Memories table schema and indexes
- FTS5 content-sync virtual table
- vec0 vector index
- Lifecycle state machine (active ↔ archive, active → trash → purge)
- Hybrid search scoring and retrieval
- SSE event broadcasting on CRUD mutations

**Out of scope:**
- Concept store (separate feature)
- Cloud sync engine (see docs/sync/)
- Backup/retention (see docs/backup/)
- Dashboard UI rendering (see docs/dashboard/)

## 2. Stakeholders and Concerns

| Stakeholder | Concern | Priority |
|---|---|---|
| AI agents (MCP consumers) | Retrieval accuracy, latency, context-window economy | High |
| Hector Jarquin (maintainer) | Schema stability, backup safety, lifecycle correctness | High |
| Cordenar Cloud (sync target) | Consistent synapse_map tracking | Med |

## 3. Architecture Context (AV-01)

The Memory feature lives within the Cordenar MCP server (see `docs/architecture.md` AV-01 for full system context). It is implemented primarily in `db.js` (memories table, CRUD, search) and `server.js` (14 tool registrations).

**Interfaces:**
- MCP tools (memory_* via server.js) — the primary API.
- Dashboard HTTP API (`GET /api/memories/:id`) — detail view.
- SSE broadcasts (`memory_new`, `memory_update`, etc.) — dashboard real-time.

## 4. Architecture Views

### 4.1 Component View (AV-02)

| Component | File | Responsibility |
|---|---|---|
| **Memories table** | db.js | SQLite schema, CRUD, lifecycle transitions |
| **FTS5 index** | db.js | Content-sync virtual table on `content` column |
| **vec0 index** | db.js | Vector index on Murmur3 embedding |
| **Search engine** | db.js | `searchLocalMemory()` / `searchTeamMemoryHybrid()` — blended FTS5+vec0 scoring |
| **Lifecycle manager** | db.js | `trashMemory`, `restoreMemory`, `deleteMemoryPermanent`, `archiveMemory`, `unarchiveMemory` |
| **Tool registration** | server.js | 14 `memory_*` tools with Zod inputSchema and withTelemetry |
| **SSE broadcaster** | dashboard.js | `notifyDash()` → all connected dashboard clients |

### 4.2 Runtime View (AV-03)

**Memory store flow:**
```
MCP Client → memory_store → server.js registerTool →
  withTelemetry span → Zod validate({project, content, ...}) →
  db.js INSERT INTO memories → recordWrite() →
  FTS5 INSERT (content-sync auto) → vec0 INSERT →
  notifyDash('memory_new', {id, project}) →
  return { id, success }
```

**Hybrid search flow:**
```
MCP Client → memory_search → server.js registerTool →
  memorySearch({query, project, kind, status, ...}) →
  vec0 query with alpha weighting → FTS5 query with (1-alpha) weighting →
  Blend results by (alpha * vec_score + (1-alpha) * fts_score) →
  Return ranked rows with scores
```

**Lifecycle transition flow:**
```
memory_trash → db.js UPDATE status='trash' → FTS5 DELETE + re-INSERT → SSE
memory_restore → db.js UPDATE status='active' → FTS5 DELETE + re-INSERT → SSE
memory_purge → db.js DELETE row + FTS5 DELETE + vec0 DELETE → SSE
memory_archive → db.js UPDATE status='archived' → excluded from default queries
memory_unarchive → db.js UPDATE status='active' → SSE
```

## 5. Architectural Decisions

### Decision AD-01: FTS5 content-sync with explicit re-index on update

- **Status:** Accepted
- **Decision:** FTS5 virtual table uses `content=` (content-sync) mode — INSERT auto-populates from the `content` column. UPDATE requires explicit `upsertHemFts` → DELETE old + INSERT new.
- **Rationale:** Content-sync eliminates manual INSERT on store. Explicit UPDATE prevents stale FTS entries when content changes via `memory_update`. DELETE+INSERT avoids FTS5's lack of UPDATE support.
- **Alternatives considered:** Full-rebuild FTS on every update (too heavy), content-less FTS (manual INSERT for both store and update).
- **Consequences:** Two FTS operations per update (DELETE + INSERT). Must ensure both succeed or rollback.
- **Traceability:** FR-04, FR-06

### Decision AD-02: vec0 DELETE + INSERT on update (no UPDATE support)

- **Status:** Accepted
- **Decision:** sqlite-vec does not support UPDATE. Indexing is DELETE + INSERT for every mutation. On `memory_store`, INSERT with Murmur3 embedding. On `memory_update`, DELETE old + INSERT new.
- **Rationale:** sqlite-vec API limitation. DELETE+INSERT is idempotent and safe. Embedding is deterministic (Murmur3), so re-insert produces identical vector.
- **Alternatives considered:** Skip vec re-index on minor updates (would cause search drift).
- **Consequences:** Two vec operations per update. Acceptable for single-user throughput.
- **Traceability:** FR-04, FR-06

### Decision AD-03: `requireFtsMatch` gate on status-filtered views

- **Status:** Accepted
- **Decision:** Status-filtered search views (dashboard filter-by-status) require FTS5 to match (`requireFtsMatch: true`) to prevent vec0 from returning irrelevant results. General MCP search uses alpha blending with no required match.
- **Rationale:** vec0 alone on a small filtered set produces noise — e.g., "pending" filter returns 7 items, vec0 ranks all 7 regardless of relevance. `requireFtsMatch` gates vec0 behind a keyword match.
- **Alternatives considered:** Disable vec0 entirely for filtered views (loses typo tolerance), raise alpha to 0.7 (still noisy).
- **Consequences:** Typo tolerance is unavailable in status-filtered views. Users must use exact or substring keywords in filtered views.
- **Traceability:** FR-01

### Decision AD-04: `_autonomy_rules` injection into every memory_brief

- **Status:** Accepted
- **Decision:** The `memory_brief` handler injects an `_autonomy_rules` directive into every response payload. This directive instructs AI agents to autonomously search memory before decisions and store facts/bugs/milestones after resolution.
- **Rationale:** MCP tool descriptions are single-line; runtime directives from the handler itself enforce autonomy behavior. Injected by the server, not the MCP prompt — so it's always present regardless of which host loads the prompt.
- **Alternatives considered:** MCP prompt only (not guaranteed to be loaded), tool description only (too short).
- **Consequences:** Agents receive autonomy directives per-call. Adds one string constant to the response payload.
- **Traceability:** FR-13

## 6. Constraints and Assumptions

**Constraints:**
- sqlite-vec extension required for vec0. Gracefully skips if unavailable (`VEC_AVAILABLE = false`).
- FTS5 content-sync requires `rowid` stability; memories table uses INTEGER PRIMARY KEY (stable rowid).
- Single-writer SQLite concurrency — no concurrent mutations.

**Assumptions:**
- AI agents consume `_autonomy_rules` directive from `memory_brief` responses.
- Memory content is predominantly English text. FTS5 tokenizer is the default (Unicode61).
- Lifecycle transitions are sequential (no parallel trash+restore race).

## 7. Risks and Mitigations

| Risk ID | Description | Impact | Mitigation |
|---|---|---|---|
| R-01 | FTS5 index desync from memories table after UPDATE | Med — stale search | UPSERT pattern: FTS DELETE + INSERT in same transaction as UPDATE |
| R-02 | vec0 index desync | Low — search degradation | DELETE + INSERT idempotent; deterministic embedding ensures identical vector |
| R-03 | `memory_purge` on non-trashed memory (with force) | Low — accidental data loss | Default requires trash-first; `force` opt-in is explicit |
| R-04 | Large memory content (>100KB) impacts VACUUM INTO backup size | Low — disk growth | Content size gated by `CORDENAR_CONTENT_MAX_SIZE` (100KB default) |

## 8. Architecture Coverage Mapping

| Architecture Item | Requirement IDs | Coverage Note |
|---|---|---|
| AD-01 (FTS5 content-sync) | FR-04, FR-06 | Index maintenance on store and update |
| AD-02 (vec0 DELETE+INSERT) | FR-04, FR-06 | Vector index maintenance |
| AD-03 (requireFtsMatch) | FR-01 | Status-filtered search quality |
| AD-04 (_autonomy_rules) | FR-13 | Autonomy directive injection |

## 9. Architecture Readiness Summary

- [x] All major decisions traced to requirement IDs
- [x] No major architecture decision left undocumented
- [x] Risks documented for critical decisions

## 10. Handoff

**Next implementation skill(s):** Memory Developer Documentation.

**Architecture handoff notes:** All memory operations must preserve FTS5+vec0 index consistency. Lifecycle transitions must broadcast SSE. `memory_brief` must inject `_autonomy_rules`.

## 11. Document Control

- **Version:** 1.0
- **Status:** Draft
- **Author:** Hector Jarquin
- **Last Updated:** 2026-09-25

## Related

- [SRS](./memory-srs.md)
- [Developer Documentation](./memory-developer-documentation.md)
- [System Architecture](../architecture.md)
