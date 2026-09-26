---
type: DeveloperReference
title: Developer Documentation: Concepts
description: Developer reference and tool documentation for the concepts feature of Cordenar MCP.
tags: [concepts, developer, api]
timestamp: 2026-09-25T00:00:00Z
---

# Developer Documentation: Concepts

**Standard:** ISO/IEC/IEEE 26514:2022

## Overview

The Concepts feature indexes markdown files into a searchable store. Concepts represent reusable knowledge: skills, agents, instructions, prompts, workflows, references, and knowledge bases.

[SRS: FR-01 through FR-07]

---

## Tool Reference

### concept_index

**Description:** Scan configured index paths for `.md` files, parse YAML frontmatter, and insert/update the concepts table with FTS5+vec0 sync. Skips `node_modules` and hidden directories (`.` prefix).

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| path | string | No | Specific path to index (defaults to all configured paths) |

**Returns:** `{ added, updated, removed }` counts.

[SRS: FR-04]

### concept_search

**Description:** Search concepts with hybrid FTS5+vec0 retrieval. Supports title-boosted BM25 field weighting.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| query | string | Yes | Search query |
| collection | string | No | Filter by collection (namespace) |
| type | string | No | Filter by concept type |
| tags | string[] | No | Filter by tags |
| weights | object | No | Field weights: `{title:10, description:5, tags:3, body:1}` |
| alpha | number | No | Blend weight (default 0.3) |

**Returns:** Ranked results with fts_score, vec_score, blended score.

[SRS: FR-01]

### concept_get

**Description:** Retrieve a full concept by collection + slug. Returns the body, metadata, and relations — `references` (descendants), `referenced_by` (ancestors), `siblings`, and `dependencies` (each carrying an `id`). Optionally resolves dependency bodies recursively.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| collection | string | Yes | Concept collection (namespace) |
| slug | string | Yes | Concept slug |
| resolve_dependencies | boolean | No | Recursively resolve referenced slugs |

[SRS: FR-06]

### concept_family

**Description:** Preview a concept's full relational family before sharing. `family` = self ∪ ancestors ∪ descendants ∪ immediate siblings (each with its subtree) ∪ transitively declared `frontmatter.dependencies` (cycle-safe; dangling deps skipped). A null/absent collection yields an empty family. Note: this dependency closure covers the whole path-family, whereas `concept_get`'s `resolved` covers only the requested concept's own dependency chain — they are intentionally different.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| collection | string | Yes | Concept collection (namespace) |
| slug | string | Yes | Concept slug |

**Returns:** `{ ancestors, descendants, siblings, family, total }` — `total` is the recursive share size.

[SRS: FR-08]

### concept_context

**Description:** Return the full concept body as formatted text for prompt injection.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| slug | string | Yes | Concept slug |

[SRS: FR-07]

### concept_search_context

**Description:** Return a formatted context string from search results for prompt injection.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| query | string | Yes | Search query |
| collection | string | No | Filter by collection (namespace) |
| scope | string | No | local or team |
| limit | number | No | Max results |

[SRS: FR-03]

### concept_list

**Description:** Paginated concept listing with filters.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| collection | string | No | Filter by collection (namespace) |
| type | string | No | Filter by concept type |
| tags | string[] | No | Filter by tags |
| scope | string | No | local or team |
| cloud_status | string | No | Filter by cloud sync status |
| limit | number | No | Max results |

[SRS: FR-02]

### concept_deindex

**Description:** Remove concepts by collection + slug, or by directory path. Files on disk are never touched.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| collection | string | No | Collection (with slug) to remove one concept |
| slug | string | No | Single concept slug (scoped to collection) |
| path | string | No | All concepts under this directory |

[SRS: FR-05]

---

## Indexing Guide

Configure index paths via `CORDENAR_INDEX_PATHS` env var (comma-separated) or `config.json`:

```json
{ "index": { "paths": ["/home/user/skills", "/home/user/docs"] } }
```

Run `concept_index` to scan and index. Concepts are automatically re-indexed on content changes (no incremental — full re-scan).

---

## Traceability

- [SRS: FR-01] concept_search
- [SRS: FR-02] concept_list
- [SRS: FR-03] concept_search_context
- [SRS: FR-04] concept_index
- [SRS: FR-05] concept_deindex
- [SRS: FR-06] concept_get
- [SRS: FR-07] concept_context

## Document Control

- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./concepts-srs.md)
- [Architecture](./concepts-architecture.md)
- [System Architecture](../architecture.md)
