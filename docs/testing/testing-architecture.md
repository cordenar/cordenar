---
type: Architecture
title: Architecture Description: Testing
description: Architecture description and ADRs for the testing feature of Cordenar MCP.
tags: [testing, architecture, adr]
timestamp: 2026-09-25T00:00:00Z
---

# Architecture Description: Testing

**Standard:** ISO/IEC/IEEE 42010:2022

## 1. Purpose

Vitest-based test infrastructure. Two test files, Cloud Tier 1 gating, temp-DB isolation.

## 2. Container View

| Component | File | Responsibility |
|---|---|---|
| Core tests | test/cordenar.test.mjs | 114 tests: auth, DB init, CRUD, lifecycle, search, sync |
| Dashboard tests | test/dashboard.test.mjs | 35 tests: API routes, health, SSE |
| Config | vitest.config.js | Vitest configuration |

## 3. ADRs

### Decision AD-01: Cloud Tier 1 gating via (CLOUD_SECRET ? describe : describe.skip)

- **Status:** Accepted
- **Decision:** Cloud integration tests are wrapped in `(CLOUD_SECRET ? describe : describe.skip)('Cloud Tier 1')`. When `CORDENAR_CLIENT_SECRET` is absent, the entire suite is skipped.
- **Rationale:** Cloud tests require a live Supabase backend + valid secret. They must not fail local runs where cloud is unavailable.
- **Traceability:** FR-04

### Decision AD-02: Temp-DB isolation

- **Status:** Accepted
- **Decision:** Tests use a temporary database path (via `CORDENAR_DB_PATH` env or in-memory), never the live `~/.cordenar/synapses.db`.
- **Traceability:** FR-05

## 4. Document Control
- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./testing-srs.md)
- [Developer Documentation](./testing-developer-documentation.md)
- [System Architecture](../architecture.md)
