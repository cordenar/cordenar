---
type: Architecture
title: Architecture Description: Concepts
description: Architecture description and ADRs for the concepts feature of Cordenar MCP.
tags: [concepts, architecture, adr]
timestamp: 2026-09-25T00:00:00Z
---

# Architecture Description: Concepts

**Standard:** ISO/IEC/IEEE 42010:2022

## 1. Purpose

Architecture of the Concepts file index and retrieval system.

## 2. Architecture Views

### 2.1 Container View

| Component | File | Responsibility |
|---|---|---|
| conceptIndex | db.js | Recursive directory scan, frontmatter parse, FTS5+vec0 insert |
| conceptDeindex | db.js | Remove by slug or directory path |
| searchComponentsHybrid | db.js | FTS5+vec0 hybrid search |
| conceptGetBySlug | db.js | Single concept retrieval + dependency resolution |

### 2.2 Runtime View

**Index:** conceptIndex(paths) → readdirRecursive → parseFrontmatter (YAML) → INSERT/UPSERT concepts row → FTS5 INSERT + vec0 INSERT → notifyDash('index_complete').

**Dependency resolution:** conceptGetBySlug resolves `resolve_dependencies: true` by reading the concept's `dependencies` field from frontmatter and recursively fetching each slug's content.

## 3. Architectural Decisions

### Decision AD-01: File-based index with path scanning

- **Status:** Accepted
- **Decision:** Concepts are indexed by scanning configured directory paths for `.md` files, parsing YAML frontmatter, and storing the extracted fields in the `concepts` table. No external database or API.
- **Rationale:** The concept source of truth is the filesystem. Scanning on `concept_index` keeps the SQLite store in sync. No import/export needed.
- **Traceability:** FR-04

### Decision AD-02: Title-boosted BM25 search (configurable weights)

- **Status:** Accepted
- **Decision:** `concept_search` supports configurable field weights (`title: 10, description: 5, tags: 3, body: 1`) for BM25 ranking. Default weighting prioritizes title matches.
- **Rationale:** Concepts are named and tagged — title and tag matches are stronger signals than body text.
- **Traceability:** FR-01

### Decision AD-03: Full-tree concept family

- **Status:** Accepted
- **Decision:** A concept's relations are computed by one helper, `computeConceptFamily({ table, cols, collection, slug })`, returning `{ ancestors, descendants, siblings, family, total }`. `family` (the recursive share set) = self ∪ ancestors ∪ descendants ∪ immediate siblings (each with its subtree) ∪ transitive `frontmatter.dependencies`. Dependencies resolve with a visited set (cycle-safe); dangling deps are skipped; a null/absent `collection` yields an empty family. The same helper serves local `concepts` (`getConceptFamily`) and team `concept_synapses` (`getRelated`); `share`/`unshare` expand it.
- **Rationale:** A skill without its references is broken; path-family alone misses non-path-adjacent declared dependencies.
- **Consequences:** `siblings` are the concept's IMMEDIATE peers (one level), but each sibling's full subtree travels with the family. Sharing a root concept of a single-tree collection therefore shares the whole collection. Surfaces: `concept_family` (local preview) and `concept_get` `siblings`. Note `concept_get.resolved` (transitive deps of *self*) and `concept_family.family` (transitive deps of the whole path-family) are deliberately different closures.
- **Traceability:** FR-06, FR-08

## 4. Risks

| Risk | Mitigation |
|---|---|
| Index staleness (files changed on disk) | Manual re-index via concept_index; no filesystem watcher |
| Large file scanning (many directories) | Index is synchronous; acceptable for <1000 files |

## 5. Document Control

- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./concepts-srs.md)
- [Developer Documentation](./concepts-developer-documentation.md)
- [System Architecture](../architecture.md)
