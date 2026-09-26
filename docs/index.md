---
okf_version: "0.1"
---

# Cordenar MCP — Documentation

Progressive-disclosure catalog for the Cordenar MCP server. Each feature has three concept files per the ISO-aligned delivery workflow: Software Requirements Specification, Architecture Description, and Developer Documentation.

## System

- [Architecture](./architecture.md) — System context, container view, 8 system ADRs (SAD-01 through SAD-08)
- [Platform Operations](./platform.md) — Environment variables, MCP conventions, autonomy stack, build/deploy, config format

## Features

### Auth
Node credential authentication with Cordenar Cloud, multi-node identity, and account listing.
- [Auth SRS](./auth/auth-srs.md) — 5 functional requirements, bot credential auth
- [Auth Architecture](./auth/auth-architecture.md) — Multi-node store, Supabase GoTrue, 3 ADRs
- [Auth Developer Documentation](./auth/auth-developer-documentation.md) — auth/deauth/status/list_accounts reference

### Memory
The core knowledge store — memories with lifecycle, hybrid search, and AI autonomy tools.
- [Memory SRS](./memory/memory-srs.md) — 14 functional requirements, lifecycle states
- [Memory Architecture](./memory/memory-architecture.md) — FTS5+vec0, lifecycle machine, 4 ADRs
- [Memory Developer Documentation](./memory/memory-developer-documentation.md) — 14-tool reference, examples

### Concepts
File-based concept index with frontmatter parsing and hybrid search.
- [Concepts SRS](./concepts/concepts-srs.md) — 8 functional requirements
- [Concepts Architecture](./concepts/concepts-architecture.md) — File index, title-boosted search, 3 ADRs
- [Concepts Developer Documentation](./concepts/concepts-developer-documentation.md) — 8-tool reference

### Projects
Project-scoped namespace management for memories.
- [Projects SRS](./projects/projects-srs.md) — 4 functional requirements
- [Projects Architecture](./projects/projects-architecture.md) — Namespace model, 2 ADRs
- [Projects Developer Documentation](./projects/projects-developer-documentation.md) — 4-tool reference

### Sync
Cloud synchronization — push/pull/unshare transport with governance.
- [Sync SRS](./sync/sync-srs.md) — 6 functional requirements, lifecycle states
- [Sync Architecture](./sync/sync-architecture.md) — Push/pull flows, synapse_map, 4 ADRs
- [Sync Developer Documentation](./sync/sync-developer-documentation.md) — 4-tool reference, integration guide

### Dashboard
Local web dashboard at `localhost:3458` — HTTP API, SSE, Basecoat + Tailwind.
- [Dashboard SRS](./dashboard/dashboard-srs.md) — 10 functional requirements, API routes
- [Dashboard Architecture](./dashboard/dashboard-architecture.md) — ES modules, 3 ADRs
- [Dashboard Developer Documentation](./dashboard/dashboard-developer-documentation.md) — API reference, module guide

### Retrieval
Cross-entity detail and relationship navigation.
- [Retrieval SRS](./retrieval/retrieval-srs.md) — 3 functional requirements
- [Retrieval Architecture](./retrieval/retrieval-architecture.md) — 2 ADRs
- [Retrieval Developer Documentation](./retrieval/retrieval-developer-documentation.md) — get/related reference

### Telemetry
OpenTelemetry observability and tool usage reporting.
- [Telemetry SRS](./telemetry/telemetry-srs.md) — 6 functional requirements
- [Telemetry Architecture](./telemetry/telemetry-architecture.md) — withTelemetry, span naming, 3 ADRs
- [Telemetry Developer Documentation](./telemetry/telemetry-developer-documentation.md) — tool_usage reference

### Backup
Backup durability — hourly VACUUM INTO snapshots with GFS-lite retention.
- [Backup SRS](./backup/backup-srs.md) — 10 functional requirements, retention policy
- [Backup Architecture](./backup/backup-architecture.md) — doBackup/enforceRetention/verifyBackup, 4 ADRs
- [Backup Developer Documentation](./backup/backup-developer-documentation.md) — Config reference, restore guide

### Testing
Vitest test suite — 149 tests, Cloud Tier 1 gating.
- [Testing SRS](./testing/testing-srs.md) — 6 functional requirements, quality gates
- [Testing Architecture](./testing/testing-architecture.md) — Test organization, Cloud Tier gating, 2 ADRs
- [Testing Developer Documentation](./testing/testing-developer-documentation.md) — How to run/write tests

## Controlled Vocabulary

| Type | Use when |
|---|---|
| `Specification` | Software Requirements Specification (SRS) under ISO 29148 |
| `Architecture` | Architecture Description, ADRs, design views under ISO 42010 |
| `DeveloperReference` | API reference, developer documentation, integration guides under ISO 26514 |
| `Reference` | Curated reference material, platform operations, cross-cutting concerns |
