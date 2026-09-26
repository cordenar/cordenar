---
type: Specification
title: Software Requirements Specification (SRS): Testing
description: Software requirements for the testing feature of Cordenar MCP.
tags: [testing, specification, requirements]
timestamp: 2026-09-25T00:00:00Z
---

# Software Requirements Specification (SRS): Testing

**Standard:** ISO/IEC/IEEE 29148:2018

## 1. Introduction

Test infrastructure for the Cordenar MCP server. Vitest-based, with Cloud Tier 1 integration tests gated behind authentication.

### 3.1 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | The test suite MUST run via `npm test` (vitest) and pass before any commit. | Must |
| FR-02 | The test suite MUST cover the auth module (Phase 1), DB init + schema (Phase 2), CRUD, lifecycle, search, and summary. | Must |
| FR-03 | The dashboard test suite MUST cover all /api/* routes (health, dashboard, stats, memories, collections, synapses, sync). | Must |
| FR-04 | Cloud Tier 1 tests MUST be gated on `CORDENAR_CLIENT_SECRET` — skipped (not failed) when the env var is absent. | Must |
| FR-05 | Tests MUST isolate against a temporary database path (not the live ~/.cordenar/synapses.db). | Must |
| FR-06 | Tests MUST clean up artifacts (temp files, test rows) in afterAll hooks. | Must |

### 3.6 States

| State | Meaning |
|---|---|
| Pass | 145 passed / 4 skipped (Cloud Tier 1 gated) |
| Skip | Cloud Tier 1 when CORDENAR_CLIENT_SECRET absent (4 tests) |

## 4. Verification

`npm test` → 110 passed + 4 skipped (Cloud Tier 1) for cordenar.test.mjs; 35 passed for dashboard.test.mjs. Total: 145 passed, 4 skipped.

## Related

- [Architecture](./testing-architecture.md)
- [Developer Documentation](./testing-developer-documentation.md)
- [System Architecture](../architecture.md)
