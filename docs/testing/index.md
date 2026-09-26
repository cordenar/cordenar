# Testing — Cordenar MCP

The Cordenar MCP test suite. 149 tests across two files: `test/cordenar.test.mjs` (114 tests) and `test/dashboard.test.mjs` (35 tests). Cloud Tier 1 integration tests are gated on `CORDENAR_CLIENT_SECRET`.

**MCP tools:** None (test infrastructure).

## Documents

- [Testing SRS](./testing-srs.md) — FRs for coverage, gating, quality gates (ISO 29148)
- [Testing Architecture](./testing-architecture.md) — vitest config, test organization, Cloud Tier gating (ISO 42010)
- [Testing Developer Documentation](./testing-developer-documentation.md) — How to run/write tests (ISO 26514)
