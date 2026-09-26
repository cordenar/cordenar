---
type: DeveloperReference
title: Developer Documentation: Projects
description: Developer reference and tool documentation for the projects feature of Cordenar MCP.
tags: [projects, developer, api]
timestamp: 2026-09-25T00:00:00Z
---

# Developer Documentation: Projects

**Standard:** ISO/IEC/IEEE 26514:2022

## Overview

Projects provide namespace scoping for memories. Created implicitly when the first memory is stored with a new project name.

---

## Tool Reference

### project_list

Returns all distinct project names with stored memories. No parameters.

### project_count

Count memories in a project, grouped by kind (fact, decision, bug, plan, note, summary).

**Parameters:** `project` (string, required).

### project_trash

Soft-delete ALL non-trashed memories in a project. Recoverable per-memory via `memory_restore`.

**Parameters:** `project` (string, required).

### project_purge

Permanently delete a project. By default requires all memories to be in trash first. Use `force: true` to bypass.

**Parameters:** `project` (string, required), `force` (boolean, optional).

---

## Traceability
- [SRS: FR-01 through FR-04]

## Document Control
- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./projects-srs.md)
- [Architecture](./projects-architecture.md)
- [System Architecture](../architecture.md)
