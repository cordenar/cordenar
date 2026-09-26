---
type: Architecture
title: Architecture Description: Retrieval
description: Architecture description and ADRs for the retrieval feature of Cordenar MCP.
tags: [retrieval, architecture, adr]
timestamp: 2026-09-25T00:00:00Z
---

# Architecture Description: Retrieval

**Standard:** ISO/IEC/IEEE 42010:2022

## 1. Purpose

Cross-entity lookup and relationship resolution. `get` is a thin wrapper over `getSynapse(cloud_id)` in db.js; `related` resolves relationships by type — memories by `related_ids`, concepts by the full relational family via `computeConceptFamily` (see Concepts AD-03).

## 2. ADRs

### Decision AD-01: Dual relationship resolution (related_ids vs full family) — SUPERSEDED

- **Status:** Superseded
- **Decision:** Memories use `related_ids` (explicit JSON array). Concepts previously used slug ancestry; they now resolve the full relational family — ancestors + immediate siblings + descendants + declared dependencies — via `computeConceptFamily` (see Concepts AD-03 and Sync architecture). One `related` tool handles both by source detection.
- **Rationale:** Memories are flat and cross-reference by ID. Concepts are hierarchical; full-tree resolution guarantees a shared concept arrives with its references intact (slug ancestry alone was incomplete).
- **Traceability:** FR-02

### Decision AD-02: get/related as cross-entity tools (not per-feature)

- **Status:** Accepted
- **Decision:** `get` and `related` are not memory_* or concept_* prefixed because they operate on the unified synapse layer (both memories and concepts) keyed by cloud UUID.
- **Traceability:** FR-01

## Related

- [SRS](./retrieval-srs.md)
- [Developer Documentation](./retrieval-developer-documentation.md)
- [System Architecture](../architecture.md)
