---
type: Specification
title: Software Requirements Specification (SRS): Sync
description: Software requirements for the sync feature of Cordenar MCP.
tags: [sync, specification, requirements]
timestamp: 2026-09-25T00:00:00Z
---

# Software Requirements Specification (SRS): Sync

**Standard:** ISO/IEC/IEEE 29148:2018

## Document Information

| Field | Value |
|---|---|
| Project | Cordenar MCP |
| Software Component | Sync — cloud synchronization engine |
| Version | 1.0 — Draft |
| Date | 2026-09-25 |
| Author | Hector Jarquin |
| Status | Draft |

---

## 1. Introduction

### 1.1 System Purpose

The Sync feature enables bidirectional synchronization of memories and concepts between the local Cordenar MCP node and Cordenar Cloud (Supabase). It manages push (share with pending_approval), pull (fetch with pagination), unshare (governance), and full sync. Concept sharing is **full-tree**: a shared concept expands to its complete family (ancestors + immediate siblings + descendants + declared dependencies), so shared skills arrive complete.

### 1.2 System Scope

Delivers 4 MCP tools: `share`, `unshare`, `pull`, `sync`. Operates on the `synapse_map` tracking table and communicates with Supabase via REST API. `share` targets a single account (the active node, or a top-level `account_slug`); `unshare` is active-node only; `pull` fetches all accounts; `sync` iterates all authenticated nodes sequentially.

### 1.3 System Overview

```
Local synapses.db ──share──► Supabase (pending_approval) ──admin approve──► active
                                                           │
Local synapses.db ◄──pull─── Supabase (active synapses) ◄──┘
                                                           │
                    unshare ──► pending_unshare ──admin──► removed
```

---

## 3. Software Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | The software MUST execute `share` to push local synapses to the cloud. Accepts `account_slug` (optional, uses active node if omitted) and an array of `synapses` (each with `source` and `id`). A **concept expands to its entire family** — ancestors + immediate siblings (each with its subtree) + descendants + transitively declared `frontmatter.dependencies` (cycle-safe; dangling skipped); memories are shared as-is. Members enter `pending_approval`. Must include Murmur3 embeddings in the push payload. Must return `{ results, family_total, newly_shared, already_shared, errors }`. | Must |
| FR-02 | The software MUST execute `unshare` to request admin review for unsharing a synapse. A concept expands to its entire family (matching `share`); the call is single-account. Members enter `pending_unshare`; the local mapping remains until admin approval. Must accept `source` (memory or concept) and `id`. Must return `{ results, total, requested, errors }`. | Must |
| FR-03 | The software MUST execute `pull` to fetch approved active synapses from all team accounts. Must use pagination (batch size 500) to drain all available synapses. Must insert/update local `synapses.db` with FTS5+vec0 sync. After all batches, must run a cleanup sweep: locally-active entries absent from cloud response are marked `cloud_status='removed'`. | Must |
| FR-04 | The software MUST execute `sync` for full bidirectional sync: push dirty (locally-edited shared) synapses, detect and unlink locally-deleted shared synapses, pull new approved synapses from cloud. Must iterate all nodes sequentially. Must broadcast SSE on completion. | Must |
| FR-05 | The software MUST detect orphan synapses (locally marked as pushed but no longer present in Supabase) during sync and fullSync. Must re-push orphans via phase C of `fullSync()`. | Must |
| FR-06 | The software MUST support multi-node routing. `pull` fetches from ALL authenticated team accounts (no per-account parameter); `share` accepts a top-level `account_slug` (active node by default); `unshare` is active-node only. `sync` must iterate all authenticated nodes. | Must |

### 3.4 Software Interfaces

| Tool | Input (required) | Input (optional) | Output |
|---|---|---|---|
| share | synapses (array of `{source, id}`) | account_slug (string) | `{ results, family_total, newly_shared, already_shared, errors }` |
| unshare | source (string), id (number) | — | `{ results, total, requested, errors }` |
| pull | — | — | Pulled count + per-node breakdown |
| sync | — | — | Pushed/unlinked/pulled counts per node |

### 3.5 Software Operations

**Share flow:** MCP → shareSynapses → createEmbedding → Supabase REST POST → `synapse_map` UPSERT with `cloud_id` + `direction='push'`.

**Pull flow:** MCP → pullSynapses → paginate 500/batch → Supabase GET (all `cloud_status` values: active, pending_approval, rejected, archived, pending_unshare, removed) → INSERT/UPSERT `memory_synapses`/`concept_synapses` with FTS5+vec0 sync → clean-up sweep (mark locally-active-but-absent as `removed`).

**Unshare flow:** MCP → unshareSynapse → POST to cloud → synapse enters `pending_unshare`. On admin approval, next `pull` removes the local mapping.

### 3.6 Software Modes and States

| State | Meaning | Transitions |
|---|---|---|
| unshared (local) | Only in local DB; not yet shared | → `pending_approval` (via share) |
| pending_approval (cloud) | Shared; waiting for admin review | → `active` (admin approve), `rejected` (admin reject) |
| active (cloud) | Approved and pulled to team nodes | → `rejected` (admin), `pending_unshare` (node unshare) |
| pending_unshare (cloud) | Node requested unshare; awaiting admin | → `removed` (admin approve), back to `active` (admin deny) |
| removed | Unlinked from local; mapping entry preserved | End state |

### 3.7 Security Requirements

| ID | Requirement |
|---|---|
| SEC-01 | The software MUST authenticate with the cloud before any sync operation. Unauthenticated nodes cannot share, pull, or sync. |
| SEC-02 | The software MUST route sync operations to the correct Supabase account using `account_slug` from the authenticated node. |
| SEC-03 | The software MUST NOT expose Supabase credentials in tool responses or logs. |

### 3.8 Data Management

Key table: `synapse_map` — tracks local-to-cloud mappings.

| Column | Type | Description |
|---|---|---|
| id | INTEGER PRIMARY KEY | Local row ID |
| cloud_id | TEXT UNIQUE | Supabase synapse UUID |
| source | TEXT | memory or concept |
| direction | TEXT | push or pull |
| cloud_status | TEXT | pending_approval, active, rejected, archived, pending_unshare, removed |
| account_id | TEXT | Basejump account UUID |

---

## 4. Verification

| Requirement Group | Verification Method |
|---|---|
| FR-01 to FR-04 | Cloud Tier 1 integration tests (test/cordenar.test.mjs, Lines 832+) |
| FR-05 (orphan detection) | fullSync phase C test |
| FR-06 (multi-node) | Multi-node auth tests (Phase 1 auth module) |

Cloud Tier 1 tests are gated on `CORDENAR_CLIENT_SECRET` and `CORDENAR_TEST_MODE` env vars — skipped in standard local runs.

---

## 5. Traceability

| SRS Requirement | Test Reference |
|---|---|
| FR-01 (share) | Cloud Tier 1 — share tests |
| FR-02 (unshare) | Cloud Tier 1 — unshare tests |
| FR-03 (pull) | Cloud Tier 1 — pull tests |
| FR-04 (sync) | Cloud Tier 1 — sync tests |

---

## 6. Appendices

### 6.1 Assumptions
- Supabase local (or cloud) instance is reachable at `config.cloudUrl`.
- The node has been authenticated (cordenar_auth) before sync operations.
- Cloud admin approves/rejects pending synapses via the Cordenar Cloud dashboard.

## Related

- [Architecture](./sync-architecture.md)
- [Developer Documentation](./sync-developer-documentation.md)
- [System Architecture](../architecture.md)
