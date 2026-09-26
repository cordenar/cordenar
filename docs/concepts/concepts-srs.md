---
type: Specification
title: Software Requirements Specification (SRS): Concepts
description: Software requirements for the concepts feature of Cordenar MCP.
tags: [concepts, specification, requirements]
timestamp: 2026-09-25T00:00:00Z
---

# Software Requirements Specification (SRS): Concepts

**Standard:** ISO/IEC/IEEE 29148:2018

## Document Information

| Field | Value |
|---|---|
| Project | Cordenar MCP |
| Software Component | Concepts — file index, search, and retrieval |
| Version | 1.0 — Draft |
| Author | Hector Jarquin |
| Status | Draft |

---

## 1. Introduction

### 1.1 System Purpose

The Concepts feature indexes markdown files from configured directories into a searchable concept store. Concepts have types (skill, agent, instruction, prompt, workflow, reference, knowledge), statuses, tags, and full-text content with FTS5+vec0 hybrid search.

### 1.2 System Overview

Eight MCP tools: `concept_index` (scan + index directories), `concept_deindex` (remove), `concept_get` (by collection + slug, with siblings), `concept_family` (full relational family preview), `concept_context` (prompt context), `concept_search` (hybrid), `concept_list` (paginated), `concept_search_context` (context string).

---

## 3. Software Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | The software MUST execute `concept_search` with hybrid FTS5+vec0 retrieval. Accepts query, collection, type, tags, scope, cloud_status, status, match, weights, boost, limit, offset, alpha. Must support title-weighted BM25 field weighting. | Must |
| FR-02 | The software MUST execute `concept_list` with paginated listing. Accepts collection, type, tags, scope, cloud_status, limit filters. | Must |
| FR-03 | The software MUST execute `concept_search_context` returning a formatted context string for prompt injection. | Must |
| FR-04 | The software MUST execute `concept_index` to scan configured index paths, parse YAML frontmatter, and insert/update the concepts table with FTS5+vec0 sync. Must skip `node_modules` and hidden directories. | Must |
| FR-05 | The software MUST execute `concept_deindex` to remove concepts. Accepts collection + slug (single concept) or path (directory). Must remove FTS5+vec0 entries. | Must |
| FR-06 | The software MUST execute `concept_get` to retrieve a concept by collection + slug. Must return `siblings` and, optionally, recursively resolve dependency slugs. All relation items carry an `id`. | Must |
| FR-07 | The software MUST execute `concept_context` to return the full concept body as formatted text for prompt injection. | Must |
| FR-08 | The software MUST execute `concept_family` to return a concept's full relational family `{ancestors, descendants, siblings, family, total}` — `family` = self ∪ ancestors ∪ descendants ∪ immediate siblings (each with its subtree) ∪ transitively declared dependencies (cycle-safe; dangling skipped). A null/absent collection yields an empty family. | Must |

### 3.4 Software Interfaces

| Tool | Key Params | Output |
|---|---|---|
| concept_search | query, collection, type, tags, weights, alpha | Ranked results with scores |
| concept_list | collection, type, tags, scope, limit | Paginated concept list |
| concept_search_context | query, collection, scope, limit | Formatted context string |
| concept_index | path? string | Index result (added, updated, removed counts) |
| concept_deindex | collection, slug, path | Deindex result |
| concept_get | collection, slug, resolve_dependencies? boolean | Full concept body + metadata + `siblings` and `id`-bearing relations |
| concept_family | collection, slug | `{ancestors, descendants, siblings, family, total}` |
| concept_context | collection, slug | Raw concept body text |

### 3.5 Software Operations

**Index flow:** MCP → conceptIndex → readdirRecursive → parse frontmatter (YAML) → INSERT/UPSERT concepts table → FTS5+vec0 sync → notifyDash('index_complete').

### 3.8 Data Management

Concepts table columns: id, slug (UNIQUE), title, description, type, tags (JSON array), status, body, created_at, updated_at. FTS5 content-sync on title+description+body. vec0 on embedding.

## 4. Verification

Auth module tests + search tests in test/cordenar.test.mjs.

---

## 5. Traceability

| SRS FR | Test |
|---|---|
| FR-01 (search) | Search tests |
| FR-04 (index) | Index tests |
| FR-06 (get) | getSynapseByCloudId tests |

## Related

- [Architecture](./concepts-architecture.md)
- [Developer Documentation](./concepts-developer-documentation.md)
- [System Architecture](../architecture.md)
