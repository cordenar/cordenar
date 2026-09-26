## 2026-09-25

- update | Aligned docs with codebase after collection/full-tree/dashboard changes: retrieval `related` = full family (retired slug-ancestry ADR); dashboard `/api/stats` hemCount/compCount → memoryCount/conceptCount, removed dead routes `/api/concepts/:slug` + `/api/synapses/slug/:slug`, added `/api/collections`; concepts `collection` param on search/list/search_context/deindex + FR-05; sync FR-06 `pull` no-params; refreshed stale FR/tool/test counts (auth 5 FRs, concepts 8 FRs / 8 tools / 3 ADRs, testing 149 tests); renumbered auth FR-06 → FR-05 | touched: docs/retrieval/*, docs/dashboard/*, docs/sync/sync-srs.md, docs/concepts/*, docs/index.md, docs/testing/*, docs/auth/*

## 2026-08-22

- create | Generated full MCP documentation bundle — 10 feature dirs (auth, memory, concepts, projects, sync, dashboard, retrieval, telemetry, backup, testing) each with SRS + Architecture + Developer Documentation + index, plus system architecture.md, platform.md, and root index.md | touched: docs/index.md, docs/architecture.md, docs/platform.md, docs/*/index.md, docs/*/*.md
- update | Applied OKF v0.1 frontmatter (type/title/description/tags/timestamp) to all concept files | touched: docs/*/*.md
- fix | Corrected dashboard HTTP routes (added 9 missing routes: /api/projects, /api/status, /api/tool-stats, /api/synapses/slug/:slug, 5 kebab actions; fixed /api/health → /health); added hash.js content-addressing ADR to sync architecture; documented backfill-embeddings script; removed stale README references (migrate.js, cordenar_tool_usage) | touched: docs/dashboard/*, docs/sync/sync-architecture.md, docs/platform.md, README.md
