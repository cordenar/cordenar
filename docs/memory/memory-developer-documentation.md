---
type: DeveloperReference
title: Developer Documentation: Memory
description: Developer reference and tool documentation for the memory feature of Cordenar MCP.
tags: [memory, developer, api]
timestamp: 2026-09-25T00:00:00Z
---

# Developer Documentation: Memory

**Standard:** ISO/IEC/IEEE 26514:2022

## Overview

The Memory feature provides 14 MCP tools for persisting, retrieving, and managing AI agent memories. Memories are stored in a local SQLite database with hybrid FTS5+vec0 search, lifecycle management, and project scoping.

**Problem it solves:** AI agents accumulate knowledge during sessions — facts, decisions, bugs, plans. Cordenar gives them a persistent, searchable, lifecycle-managed memory store that survives across sessions and can be shared across team nodes.

**Design philosophy:** Local-first. All retrieval runs against `synapses.db` with zero cloud dependency. `memory_search` combines exact keyword matching (FTS5) with semantic/typo-tolerant vectors (vec0). Lifecycle is explicit: trash → restore → purge.

**Version:** Cordenar v1.0.0. Memories table exists since initial commit (2026-07-10).

[SRS: FR-01 through FR-14]

---

## Tool Reference

### memory_search

**Description:** Search memories with hybrid FTS5+vec0 retrieval by keyword and vector similarity.

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| query | string | Yes | — | Search query (keywords + semantic) |
| project | string | No | — | Filter by project namespace |
| kind | string | No | — | Filter by kind (fact, decision, bug, plan, note, progressive_summary) |
| status | string | No | — | Filter by lifecycle status (active, archived, trash) |
| scope | string | No | `local` | `local` or `team` (cloud-synced) |
| cloud_status | string | No | — | Filter by cloud sync status |
| limit | number | No | 10 | Max results |
| offset | number | No | 0 | Pagination offset |
| alpha | number | No | 0.3 | Blend weight: 0=FTS5 only, 1=vec0 only |

**Returns:** Array of memories ranked by blended score (fts_score, vec_score, score). Each row includes id, project, kind, status, content (truncated), metadata, and scores.

**Example:**
```json
{
  "query": "backup retention GFS",
  "project": "cordenar",
  "kind": "decision",
  "alpha": 0.5
}
```

### memory_list

**Description:** List memories with pagination and optional filters.

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| project | string | No | — | Filter by project |
| kind | string | No | — | Filter by kind |
| scope | string | No | `local` | `local` or `team` |
| cloud_status | string | No | — | Cloud sync status filter |
| limit | number | No | 10 | Max results per page |

**Returns:** Array of memories with metadata.

### memory_context

**Description:** Returns formatted context string for prompt injection. Raw text, not JSON.

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| query | string | Yes | — | Search query |
| project | string | No | — | Restrict to project |
| scope | string | No | — | `local` or `team` |
| limit | number | No | — | Max context entries |

**Returns:** Formatted plain text suitable for LLM context windows.

[SRS: FR-03]

### memory_store

**Description:** Persist a new memory. Use autonomously after completing a task, fixing a bug, or reaching a milestone.

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| project | string | Yes | — | Project namespace |
| content | string | Yes | — | The memory body (markdown) |
| kind | string | No | `note` | fact, decision, bug, plan, note, progressive_summary |
| related_ids | number[] | No | [] | IDs of related memories |
| status | string | No | `active` | Initial lifecycle status (active by default; kind-specific defaults for decision/bug/plan) |
| metadata | object | No | {} | Arbitrary key-value metadata |

**Returns:** `{ id: number, success: true }` on success. Throws on validation error.

**Errors:**
- `project` is required and non-empty
- `content` is required and non-empty

**Example:**
```json
{
  "project": "cordenar",
  "content": "## Backup retention — GFS-lite policy...",
  "kind": "decision"
}
```

[SRS: FR-04]

### memory_get

**Description:** Retrieve a single memory by project and ID. Returns full row with parsed metadata and related_ids.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| project | string | Yes | Project namespace |
| id | number | Yes | Memory ID |

**Returns:** Full memory object (id, project, kind, content, status, metadata, related_ids, created_at, updated_at).

**Errors:** `Memory #N not found in project 'X'` if the memory does not exist in that project.

[SRS: FR-05]

### memory_update

**Description:** Modify an existing memory. Re-indexes FTS5 and vec0 if content changes.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| id | number | Yes | Memory ID |
| project | string | Yes | Must match the memory's project |
| kind | string | No | New kind |
| content | string | No | New content (triggers FTS+vec re-index) |
| metadata | object | No | New metadata (merge-replaces) |
| related_ids | number[] | No | New related ID set |
| status | string | No | New lifecycle status |

**Returns:** `{ updated: boolean }`.

[SRS: FR-06]

### memory_trash

**Description:** Soft-delete a memory. Recoverable via `memory_restore`.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| project | string | Yes | Project namespace |
| id | number | Yes | Memory ID |

**Returns:** `{ deleted: boolean }`.

[SRS: FR-07]

### memory_restore

**Description:** Recover a soft-deleted memory from trash back to active.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| project | string | Yes | Project namespace |
| id | number | Yes | Memory ID |

**Returns:** `{ restored: boolean }`.

[SRS: FR-08]

### memory_purge

**Description:** Permanently delete a memory and its FTS5+vec0 entries.

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| project | string | Yes | — | Project namespace |
| id | number | Yes | — | Memory ID |
| force | boolean | No | false | Bypass trash-first requirement |

**Returns:** `{ purged: boolean }`.

**Errors:** Returns `isError: true` if the memory is not in trash and `force` is not true.

[SRS: FR-09]

### memory_archive

**Description:** Archive a memory. Archived memories are excluded from default search/list/context.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| project | string | Yes | Project namespace |
| id | number | Yes | Memory ID |

**Returns:** `{ archived: boolean }`.

[SRS: FR-10]

### memory_unarchive

**Description:** Restore an archived memory back to active.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| project | string | Yes | Project namespace |
| id | number | Yes | Memory ID |

**Returns:** `{ unarchived: boolean }`.

[SRS: FR-11]

### memory_reassign

**Description:** Move memories between projects. If `ids` is provided, moves only those. If omitted, moves ALL memories from `from_project`.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| from_project | string | Yes | Source project |
| to_project | string | Yes | Target project |
| ids | number[] | No | Specific memory IDs to move (omitting moves all) |

**Returns:** `{ moved: number }` — count of moved memories.

[SRS: FR-12]

### memory_brief

**Description:** AUTONOMOUSLY execute at session start. Returns lightweight project metadata: last summary staleness, pending counts, open bug counts, activity counts.

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| project | string | No | — | Restrict to a single project (omitting returns all projects) |

**Returns:** Brief object per project, plus `_autonomy_rules` directive injected into every response.

[SRS: FR-13]

### memory_progressive_summary

**Description:** Assesses whether a new progressive summary is needed using dual-threshold logic (context pressure ≤20% OR ≥10 turns since last summary). Returns the freshest existing summary if still current, or structured data for a new summary.

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| project | string | Yes | — | Project to assess |
| turns_since_last | number | No | — | Turns since last summary |
| context_remaining_pct | number | No | — | Context window remaining percentage |

**Returns:** Current summary (if not yet due) or structured data prompting agent to synthesize a new one.

[SRS: FR-14]

---

## Lifecycle Management

Memories follow a 4-state lifecycle:

```
active ──► archived ──► (hidden from default views)
active ──► trash ────► purged (permanent)
trash  ──► active (restore)
archived ──► active (unarchive)
```

- **active** — visible in all default views. Default status for new memories.
- **archived** — excluded from default search/list/context. Use when a memory should stay but not clutter results. Recoverable.
- **trash** — soft-deleted. Hidden. Recoverable via `memory_restore`. Purge-eligible.
- **purged** — permanently deleted. Row and indexes removed.

Kind-specific defaults: `decision` defaults to `proposed`, `bug` defaults to `open`, `plan` defaults to `pending`, `progressive_summary` defaults to no status.

---

## Examples

### Store and retrieve a decision

```
memory_store { project: "cordenar", content: "Use GFS-lite for backup retention.", kind: "decision" }
→ { id: 738, success: true }

memory_get { project: "cordenar", id: 738 }
→ { id: 738, kind: "decision", content: "Use GFS-lite...", ... }
```

### Search with typo tolerance (vec0)

```
memory_search { query: "cordenor", alpha: 0.7 }
→ Returns "cordenar" matches via vec0 proximity (cosine distance ~0.08)
```

### Lifecycle: trash → restore → purge

```
memory_trash { project: "cordenar", id: 738 }     → { deleted: true }
memory_restore { project: "cordenar", id: 738 }   → { restored: true }
memory_purge { project: "cordenar", id: 738 }     → Error (not in trash)
memory_trash { project: "cordenar", id: 738 }     → { deleted: true }
memory_purge { project: "cordenar", id: 738 }     → { purged: true }
```

---

## Performance

- FTS5 queries scan the inverted index — sub-millisecond for thousands of rows.
- vec0 distance computations run in C (sqlite-vec) — <10ms for 4096-candidate search.
- `memory_store` syncs FTS5 (content-sync) and vec0 (INSERT) — <50ms per insert with 4096 candidates.
- `memory_update` with content change: FTS5 DELETE + INSERT + vec0 DELETE + INSERT — ~100ms.
- `requireFtsMatch` on filtered views prevents vec0 from scanning irrelevant candidates.

---

## Troubleshooting

### Issue: `memory_search` returns no results with `alpha > 0`
**Symptom:** Query returns 0 results despite the memory existing.
**Cause:** The embedding module (`sqlite-vec`) may not be loaded. Check `VEC_AVAILABLE` flag. If false, vec0 queries return nothing and only FTS5 contributes.
**Solution:** Ensure sqlite-vec is installed.

### Issue: `memory_purge` returns error
**Symptom:** `{ isError: true }` when calling memory_purge.
**Cause:** The memory is not in `trash` state and `force` was not passed.
**Solution:** Trash first, or pass `force: true`.

### Issue: Stale search results after `memory_update`
**Symptom:** Updated content doesn't appear in search results.
**Cause:** FTS5+vec0 re-index race — the update may not have completed or the transaction rolled back.
**Solution:** Verify `memory_update` returned `{ updated: true }`. Re-run the search. Check console for FTS5 errors.

---

## Traceability

- [SRS: FR-01] `memory_search` — hybrid FTS5+vec0 retrieval
- [SRS: FR-02] `memory_list` — paginated listing
- [SRS: FR-03] `memory_context` — prompt-context formatting
- [SRS: FR-04] `memory_store` — persistent storage with index sync
- [SRS: FR-05] `memory_get` — single-memory retrieval
- [SRS: FR-06] `memory_update` — mutation with index re-sync
- [SRS: FR-07 to FR-11] Lifecycle tools (trash, restore, purge, archive, unarchive)
- [SRS: FR-12] `memory_reassign` — project migration
- [SRS: FR-13] `memory_brief` — session-start awareness
- [SRS: FR-14] `memory_progressive_summary` — context-window management

---

## Document Control

- **Version:** 1.0
- **Status:** Draft
- **Author:** Hector Jarquin
- **Last Updated:** 2026-09-25

## Related

- [SRS](./memory-srs.md)
- [Architecture](./memory-architecture.md)
- [System Architecture](../architecture.md)
