---
type: Specification
title: Software Requirements Specification (SRS): Projects
description: Software requirements for the projects feature of Cordenar MCP.
tags: [projects, specification, requirements]
timestamp: 2026-09-25T00:00:00Z
---

# Software Requirements Specification (SRS): Projects

**Standard:** ISO/IEC/IEEE 29148:2018

## 1. Introduction

Project-scoped namespace management. Projects are derived from the `project` column in the `memories` table — no separate projects table.

### 3.1 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | The software MUST execute `project_list` to return all distinct project namespaces with stored local memories. | Must |
| FR-02 | The software MUST execute `project_count` to count non-trashed memories in a project, grouped by kind. | Must |
| FR-03 | The software MUST execute `project_trash` to soft-delete ALL non-trashed memories in a project (recoverable). | Must |
| FR-04 | The software MUST execute `project_purge` to permanently delete a project and all its local memories. By default requires all memories to be in trash first unless `force=true`. | Must |

### 3.4 Interfaces

| Tool | Params | Output |
|---|---|---|
| project_list | — | Array of project names |
| project_count | project (string) | Counts object grouped by kind |
| project_trash | project (string) | `{ trashed: number }` |
| project_purge | project (string), force? boolean | `{ purged: number }` |

## Related

- [Architecture](./projects-architecture.md)
- [Developer Documentation](./projects-developer-documentation.md)
- [System Architecture](../architecture.md)
