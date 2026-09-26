---
type: DeveloperReference
title: Developer Documentation: Testing
description: Developer reference and tool documentation for the testing feature of Cordenar MCP.
tags: [testing, developer, api]
timestamp: 2026-09-25T00:00:00Z
---

# Developer Documentation: Testing

**Standard:** ISO/IEC/IEEE 26514:2022

## Overview

Vitest-based test suite. 149 tests across two files. Cloud Tier 1 integration tests gated on `CORDENAR_CLIENT_SECRET`.

## Running Tests

```bash
npm test                                    # full suite
npx vitest run                              # same, explicit
npx vitest run test/cordenar.test.mjs       # core tests only
npx vitest run test/dashboard.test.mjs      # dashboard tests only
```

Expected: 145 passed, 4 skipped (Cloud Tier 1, gated).

## Running Cloud Tier 1

```bash
CORDENAR_CLIENT_SECRET=sb_secret_... CORDENAR_TEST_MODE=1 npx vitest run test/cordenar.test.mjs
```

Requires a running Supabase instance at `CORDENAR_CLOUD_URL`.

## Writing Tests

- New memory/concept tests go in `test/cordenar.test.mjs`, organized by `describe` block.
- Dashboard API tests go in `test/dashboard.test.mjs`.
- Use `beforeAll`/`afterAll` for setup/cleanup.
- Isolate against a temp DB path — never mutate the live database.
- Gate cloud-dependent tests behind `(CLOUD_SECRET ? describe : describe.skip)`.

## Traceability
- [SRS: FR-01 through FR-06]

## Document Control
- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./testing-srs.md)
- [Architecture](./testing-architecture.md)
- [System Architecture](../architecture.md)
