---
type: DeveloperReference
title: Developer Documentation: Sync
description: Developer reference and tool documentation for the sync feature of Cordenar MCP.
tags: [sync, developer, api]
timestamp: 2026-09-25T00:00:00Z
---

# Developer Documentation: Sync

**Standard:** ISO/IEC/IEEE 26514:2022

## Overview

The Sync engine provides 4 MCP tools for bidirectional synchronization between the local Cordenar node and Cordenar Cloud (Supabase). Synapses enter `pending_approval` on share, require admin approval, and are pulled to all team nodes when active.

**Design philosophy:** Push with embedding, pull with pagination (500/batch), unshare governance, multi-node routing. The `synapse_map` table tracks every local↔cloud mapping.

[SRS: FR-01 through FR-06]

---

## Tool Reference

### share

**Description:** Push local synapses to the cloud. Synapses enter `pending_approval` until an admin approves or rejects them. A **concept expands to its entire family** — ancestors + immediate siblings (each with its subtree) + descendants + transitively declared `frontmatter.dependencies` (cycle-safe; dangling skipped) — so shared skills arrive complete. Memories are shared as-is. Sharing is single-account (the active node, or a top-level `account_slug`); a full tree is inherently one account.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| synapses | array of `{source, id}` | Yes | Array of synapse descriptors. `source`: `'memory'` or `'concept'`. `id`: local row ID. |
| account_slug | string | No | Target cloud account (uses active node if omitted) |

**Returns:** `{ results, family_total, newly_shared, already_shared, errors }` — `results` is the per-member outcome array (`status`: shared/already_shared/duplicate/error/not_found, `id`, `cloud_id`); `family_total` is the recursive share size (concept-family members + 1 per memory).

**Errors:** Returns `isError: true` if any synapse failed. Authentication must be completed first.

**Example:**
```json
{
  "synapses": [
    { "source": "memory", "id": 738 },
    { "source": "concept", "id": 42 }
  ]
}
```

[SRS: FR-01]

### unshare

**Description:** Request admin review to unshare a synapse. The synapse enters `pending_unshare` in the cloud. On admin approval, the local mapping is removed on the next pull/sync. On denial, it stays active. A **concept expands to its entire family** (matching `share`). Single-account — the active node.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| source | string | Yes | `'memory'` or `'concept'` |
| id | number | Yes | Local synapse ID |

**Returns:** `{ results, total, requested, errors }` — `total` is the family size, `requested` the members whose `request_unshare` succeeded.

**Errors:** Authentication required.

[SRS: FR-02]

### pull

**Description:** Fetch approved active synapses from all team accounts. Uses pagination (batch 500) to drain all available synapses. Store locally with FTS5+vec0 sync. After all batches, cleanup sweep marks locally-present-but-absent entries as `removed`.

**Parameters:** None.

**Returns:** Object with `pulled` count and per-node breakdown.

[SRS: FR-03]

### sync

**Description:** Full bidirectional sync. Phase A: push locally-edited shared synapses. Phase B: detect and unlink locally-deleted shared synapses. Phase C: run orphan detection (batch-verify cloud_ids via Supabase IN(), re-push orphans). Phase D: pull new approved synapses.

**Parameters:** None.

**Returns:** Object with `nodes` array, each containing `pushed`, `unlinked`, `pulled` counts and optional `error`.

[SRS: FR-04, FR-05, FR-06]

---

## Cloud Integration Guide

### Authentication

Before any sync operation, authenticate with the cloud:

```
cordenar_auth { client_secret: "sb_secret_..." }
→ nodes: [{ node_id, account_name, account_slug, active }]
```

The active node's `account_slug` is used for subsequent sync operations unless overridden.

### Full sync workflow

```
1. cordenar_auth → authenticate
2. cordenar_share → push local synapses (pending_approval)
3. [admin approves in Cloud Dashboard]
4. cordenar_pull → fetch approved synapses
5. cordenar_sync → full bidirectional (push + unlink + orphan + pull)
```

### Multi-node

A single Cordenar instance can be authenticated with multiple cloud accounts. Use `cordenar_status` to see all nodes, `cordenar_auth { account_slug }` to switch active, and `cordenar_share { account_slug }` to target a specific account.

`cordenar_sync` iterates all authenticated nodes sequentially.

---

## Troubleshooting

### Issue: `share` returns `isError: true`

**Symptom:** Share response has `isError: true` with some synapses showing status `error`.
**Cause:** Authentication missing or expired, or the synapse content exceeds cloud limits.
**Solution:** Run `cordenar_auth` to re-authenticate. Check console for the specific error message.

### Issue: `pull` returns 0 pulled

**Symptom:** Pull succeeds but `pulled: 0`.
**Cause:** No pending synapses for this node, or authentication issue.
**Solution:** Run `cordenar_share` first, then admin must approve via Cloud Dashboard.

### Issue: Orphan synapses after `sync`

**Symptom:** Some shared synapses disappear after sync.
**Cause:** The cloud admin may have deleted the synapse directly; the sync phase C detected the orphan and re-pushed, OR the local entry was removed by the cleanup sweep.
**Solution:** Check `synapse_map` for `cloud_status='removed'` entries. Re-share if needed.

---

## Traceability

- [SRS: FR-01] `share` — push with embedding
- [SRS: FR-02] `unshare` — governance request
- [SRS: FR-03] `pull` — paginated fetch + cleanup
- [SRS: FR-04, FR-05, FR-06] `sync` — bidirectional + orphan detection + multi-node

---

## Document Control

- **Version:** 1.0
- **Status:** Draft
- **Author:** Hector Jarquin
- **Last Updated:** 2026-09-25

## Related

- [SRS](./sync-srs.md)
- [Architecture](./sync-architecture.md)
- [System Architecture](../architecture.md)
