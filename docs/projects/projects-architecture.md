---
type: Architecture
title: Architecture Description: Projects
description: Architecture description and ADRs for the projects feature of Cordenar MCP.
tags: [projects, architecture, adr]
timestamp: 2026-09-25T00:00:00Z
---

# Architecture Description: Projects

**Standard:** ISO/IEC/IEEE 42010:2022

## 1. Purpose

Projects are lightweight namespace containers derived from the `project` column in the `memories` table. No separate projects table — project "existence" is implied by having memories with that project value.

## 2. ADRs

### Decision AD-01: No separate projects table

- **Status:** Accepted
- **Decision:** Project existence is derived from `SELECT DISTINCT project FROM memories`. No dedicated `projects` table.
- **Rationale:** At Cordenar's scale (single-user, local-first), a separate table adds schema complexity with no benefit. Project-level operations (`trash`, `purge`) use bulk UPDATE/DELETE on the memories table.
- **Traceability:** All FRs

### Decision AD-02: Cascade delete and trash with SSE broadcast

- **Status:** Accepted
- **Decision:** `project_trash` and `project_purge` affect ALL memories in the project, not individual rows. SSE broadcasts per operation.
- **Traceability:** FR-03, FR-04

## 3. Document Control

- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./projects-srs.md)
- [Developer Documentation](./projects-developer-documentation.md)
- [System Architecture](../architecture.md)
