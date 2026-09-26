---
type: Architecture
title: Architecture Description: Sync
description: Architecture description and ADRs for the sync feature of Cordenar MCP.
tags: [sync, architecture, adr]
timestamp: 2026-09-25T00:00:00Z
---

# Architecture Description: Sync

**Standard:** ISO/IEC/IEEE 42010:2022

## 1. Purpose and Scope

**Purpose:** Architecture of the cloud synchronization engine — push/pull/unshare transport between the local Cordenar node and Cordenar Cloud (Supabase).

**In scope:** share, unshare, pull, sync tool flows; synapse_map design; multi-node routing; orphan detection; embedding transport.

**Out of scope:** Cloud dashboard approval UI; Supabase schema/migrations; Cloud dashboard architecture.

## 2. Stakeholders

| Stakeholder | Concern | Priority |
|---|---|---|
| AI agents (MCP) | Share accuracy, pull freshness | High |
| Hector Jarquin (maintainer) | Sync reliability, conflict resolution, orphan handling | High |
| Cloud admins | Synapse governance (approval/rejection) | Med |

## 3. Architecture Context

The Sync engine bridges the local Cordenar node (`sync.js`) and Cordenar Cloud (`cordenar-cloud/docs/`). Communication is HTTP REST to Supabase. Authentication uses the node's JWT token from `cordenar_auth`.

## 4. Architecture Views

### 4.1 Container View

| Component | File | Responsibility |
|---|---|---|
| shareSynapses | sync.js | Push local synapses → Supabase, includes Murmur3 embeddings |
| unshareSynapse | sync.js | Request unshare governance |
| pullSynapses | sync.js | Paginated pull from Supabase, cleanup sweep |
| fullSync | sync.js | Full bidirectional sync across all nodes |
| synapse_map | db.js | Local tracking table mapping local IDs to cloud UUIDs |
| Supabase REST | cordenar-cloud | RPCs: get_synapses, approve_synapse, reject_synapse |

### 4.2 Runtime Views

**Push (share):** shareSynapses → createEmbedding (Murmur3 256-dim) → embeddingToString → Supabase REST POST → UPSERT synapse_map (cloud_id, direction='push').

**Pull:** pullSynapses → paginate 500/batch → Supabase GET (all cloud_status) → INSERT/UPSERT memory_synapses/concept_synapses + FTS5+vec0 sync → cleanup: mark locally-active-but-absent entries as `removed`.

**Full sync (3-phase):** Phase A: push dirty per-node. Phase B: pull per-node. Phase C: orphan detection — verify cloud_id existence via Supabase IN() query, re-push orphans.

## 5. Architectural Decisions

### Decision AD-01: Pull fetches ALL cloud_statuses (not just active)

- **Status:** Accepted
- **Decision:** `pullSynapses` fetches synapses with any `cloud_status` (active, pending_approval, rejected, archived, pending_unshare, removed). Non-active entries UPDATE `cloud_status` only (no content replacement). Active entries get full INSERT/UPDATE with FTS5+vec0 sync.
- **Rationale:** Preserves the rejection/unshare signal so the user knows what was rejected and can fix + re-share. Avoids silently removing pending_unshare or rejected entries on next pull.
- **Consequences:** Pull payload includes non-active entries. Adds ~1 UPDATE per non-active synapse. Cleanup sweep marks absent entries as `removed`.

### Decision AD-02: Pagination loop (batch 500) on pull

- **Status:** Accepted
- **Decision:** Pull uses a pagination loop with batch size 500. Drains until the Supabase `total` count is exhausted. No artificial ceiling.
- **Rationale:** Previous code hard-capped at 500 — missing synapses beyond the cap. Pagination ensures all synapsed content reaches the node.
- **Consequences:** Pull time grows linearly with synapse count. Acceptable for team-scale (hundreds to low thousands).

### Decision AD-03: Orphan detection via fullSync phase C

- **Status:** Accepted
- **Decision:** `fullSync()` phase C batch-verifies all push entries' `cloud_id` via Supabase IN() queries. Locally-present `cloud_id` values not found on Supabase are re-pushed as new synapses. This handles the case where an admin removes a synapse from Supabase directly.
- **Rationale:** Ensures the local node and cloud stay in sync even under direct Supabase manipulation. Prevents "ghost" push entries with no cloud correspondence.
- **Consequences:** One additional Supabase query per fullSync. Orphans are re-pushed immediately.

### Decision AD-04: Multi-node routing via account_slug

- **Status:** Accepted (amended 2026-09: share/unshare are single-account)
- **Decision:** Each authenticated node has an `account_slug`. Sync operations accept `account_slug` to target a specific Supabase account. `fullSync` iterates all nodes sequentially. `share`/`unshare` take a single top-level `account_slug` (active node by default); the former per-item `account_slug` mixed batch was removed — a full-tree share is inherently one account.
- **Rationale:** A single Cordenar instance may be authenticated with multiple organizations. Routing per account_slug prevents cross-account data leakage.
- **Consequences:** Sequential iteration (not parallel) — simpler and avoids rate-limit contention on Supabase.

### Decision AD-05: Content-addressed hashing via hash.js

- **Status:** Accepted
- **Decision:** Synapses are content-addressed — `hash.js` exports `computeHash(content)` which produces a SHA-256 hex digest of the content. The sync engine hashes content to detect changes and reconcile across nodes.
- **Rationale:** Content hashing gives a deterministic identity for a synapse independent of row IDs or timestamps, enabling change detection and cross-node reconciliation. The cloud side mirrors this (see cloud ADR-06, "Content-Addressed Immutable Synapses").
- **Alternatives:** Row-ID identity (breaks across nodes), timestamp-based change detection (unreliable).
- **Consequences:** A small crypto utility (`hash.js`) imported by `sync.js`. Deterministic — the same content always hashes identically.
- **Traceability:** FR-01, FR-05

### Decision AD-06: Full-tree related sharing

- **Status:** Accepted
- **Decision:** Sharing a concept distributes its entire family. `computeConceptFamily({ table, cols, collection, slug })` (db.js) returns `{ ancestors, descendants, siblings, family, total }`, where `family` = self ∪ ancestors ∪ descendants ∪ immediate siblings (each with its subtree) ∪ transitive `frontmatter.dependencies`. Dependencies resolve with a visited set (cycle-safe); dangling deps are skipped; a null/absent `collection` yields an empty family. `share`/`unshare` always expand the full family (no opt-in flags); `unshare` is single-account. `related` returns the family within `concept_synapses`; `concept_family` previews it locally.
- **Rationale:** A skill without its references is broken. Path-family alone is insufficient — declared dependencies may be non-path-adjacent, so a path-only distribution ships a broken bundle.
- **Alternatives:** Explicit multi-select (client-driven and error-prone — the original collection-blind share path); path-family only (incomplete for cross-branch dependencies).
- **Consequences:** One family helper shared by local `concepts` and team `concept_synapses` (no duplicated semantics). A root concept in a single-tree collection expands to the whole collection. Team rows carry `collection` end-to-end (push, pull, and reads).
- **Note (identity):** Cloud `concept_synapses` identity is `UNIQUE(account_id, source_node_id, content_hash)` — `collection` is NOT part of it. Two family members (or two concepts across different collections) with byte-identical bodies collide; the later insert is reported `duplicate` and skipped. Content-addressing is by design.
- **Traceability:** FR-01, FR-02

## 6. Risks

| Risk ID | Description | Impact | Mitigation |
|---|---|---|---|
| R-01 | Supabase unreachable during pull | Med — stale data | Graceful error; system operates offline |
| R-02 | Node token expiry mid-sync | Med — partial sync | Token refresh in supabase.js; needs_reauth flag |
| R-03 | Orphan accumulation (cloud_ids deleted from Supabase) | Low — ghost entries | FullSync phase C orphan detection + re-push |
| R-04 | Byte-identical concept bodies collide on `UNIQUE(account_id, source_node_id, content_hash)` | Low — a duplicate family member is skipped | Content-addressing is intentional; keep bodies distinct |

## 7. Architecture Coverage Mapping

| AD | Requirement IDs |
|---|---|
| AD-01 | FR-03 (pull all statuses) |
| AD-02 | FR-03 (pagination) |
| AD-03 | FR-05 (orphan detection) |
| AD-04 | FR-06 (multi-node) |
| AD-05 | FR-01, FR-05 (content hashing) |

## 8. Handoff

**Next:** Sync Developer Documentation.

**Handoff notes:** All sync operations must authenticate first. Pull must include cleanup sweep. FullSync must run phase C orphan detection.

## 9. Document Control

- **Version:** 1.0
- **Status:** Draft
- **Author:** Hector Jarquin
- **Last Updated:** 2026-09-25

## Related

- [SRS](./sync-srs.md)
- [Developer Documentation](./sync-developer-documentation.md)
- [System Architecture](../architecture.md)
