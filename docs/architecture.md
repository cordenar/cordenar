---
type: Architecture
title: Architecture Description: Cordenar MCP
description: System architecture description for the Cordenar MCP server.
tags: [cordenar, architecture, system]
timestamp: 2026-09-25T00:00:00Z
---

# Architecture Description: Cordenar MCP

**Standard:** ISO/IEC/IEEE 42010:2022

## 1. Purpose and Scope

**Purpose:** This document describes the system architecture of the Cordenar MCP server — a local-first Model Context Protocol server that stores memories and concepts in SQLite with hybrid FTS5+vec0 retrieval, optional cloud synchronization through Supabase, and a local web dashboard.

**In scope:**
- System context and external interfaces (MCP clients, Supabase cloud, local filesystem)
- Container/component decomposition (server, database, sync engine, dashboard)
- Runtime interaction flows (tool invocation, cloud sync, backup)
- Deployment model (npm global install, systemd)
- Architectural decisions with rationale

**Out of scope:**
- Detailed technical design (class-level/file-level)
- Feature-specific architecture (see per-feature architecture docs)
- Cloud dashboard architecture (see cordenar-cloud docs)
- Task plans

## 2. Stakeholders and Concerns

| Stakeholder | Concern | Priority |
|---|---|---|
| Hector Jarquin (maintainer) | Correctness, testability, single-maintainer velocity | High |
| AI agents (MCP consumers) | Tool availability, retrieval accuracy, latency | High |
| Human users (dashboard) | Discoverability, search UX, data safety | Med |
| Cordenar Cloud (sync target) | Data integrity, conflict resolution | Med |

## 3. Architecture Context (AV-01)

**System context summary:**

Cordenar MCP sits between AI applications (MCP clients) and external systems. It is a **local-first, embeddable knowledge store** with optional cloud sync:

```
┌─────────────────┐     MCP stdio     ┌──────────────────────┐     HTTP/REST     ┌─────────────────┐
│  MCP Clients    │◄─────────────────►│   Cordenar MCP       │◄─────────────────►│  Supabase Cloud │
│  (OpenCode,     │                   │   (Node.js server)   │                   │  (Basejump)     │
│   Cursor,       │                   │                      │                   │                 │
│   VS Code,      │                   │  ┌────────────────┐  │                   │  ┌───────────┐  │
│   Claude)       │                   │  │  SQLite DB      │  │                   │  │ synapse_   │  │
└─────────────────┘                   │  │  (synapses.db)  ││  │                   │  │ map        │  │
                                      │  │  FTS5 + vec0   │  │                   │  │            │  │
      ┌─────────────────┐            │  └────────────────┘  │                   │  └───────────┘  │
      │  Local Browser  │            │                      │                   └─────────────────┘
      │  (dashboard)    │◄──────────►│  ┌────────────────┐  │
      │  :3458          │   HTTP     │  │  Web Dashboard │  │        ┌──────────────────┐
      └─────────────────┘            │  │  (Basecoat +   │  │        │  ~/.cordenar/    │
                                     │  │   Tailwind v4) │  │        │  backups/        │
                                     │  └────────────────┘  │        └──────────────────┘
                                     │                      │
                                     │  ┌────────────────┐  │
                                     │  │  Local FS      │  │
                                     │  │  concepts/      │  │
                                     │  │  auth.json      │  │
                                     │  └────────────────┘  │
                                     └──────────────────────┘
```

**Interfaces at context level:**
- **MCP stdio** — JSON-RPC over stdin/stdout. The primary interface. All 36 tools exposed.
- **Dashboard HTTP** — `localhost:3458`. REST API for the web UI. SSE for real-time updates.
- **Supabase REST** — `cloudUrl/api/*`. Push/pull synapses. Node credential auth.
- **Local filesystem** — concept index (reads .md files), backups (writes .db files), auth.json, config.json.

## 4. Architecture Views

### 4.1 Container View (AV-02)

| Container | Responsibility | Technology |
|---|---|---|
| **MCP Entry** (`index.js`) | stdio transport, `McpServer` factory, server lifecycle | @modelcontextprotocol/server, Node stdio |
| **Tool Server** (`server.js`) | 36 tool registrations, input validation, telemetry wrapping, MCP prompt | Zod, withTelemetry, OpenAI MCP SDK |
| **Database** (`db.js`) | SQLite schema, CRUD, FTS5+vec0 hybrid search, memory lifecycle, concept index, project ops, backup/retention durability | better-sqlite3, sqlite-vec |
| **Sync Engine** (`sync.js`) | Cloud push/pull, synapse_map, unshare governance, multi-node routing, orphan detection | Supabase REST, embedding.js (Murmur3) |
| **Auth** (`auth.js`) | Multi-node credential auth, token management, node switching | Supabase (GoTrue), localStorage |
| **Embeddings** (`embedding.js`) | Murmur3 hash → 256-dim vector (deterministic, local, zero API cost) | MurmurHash3, Float32Array |
| **Telemetry** (`otel.js`) | OTel spans, tool_calls table, span recording | OpenTelemetry SDK |
| **Config** (`config.js`) | Env-variable-driven configuration, defaults, deep-merge with config.json | Node fs |
| **Web Dashboard** (`dashboard.js` + `public/`) | HTTP server, REST API, SSE, static file serving | Node http, Basecoat, Tailwind v4 CDN |

### 4.2 Runtime Interaction View (AV-03)

**Tool invocation flow (all 36 tools):**
```
MCP Client → stdio JSON-RPC → index.js → server.js registerTool →
  withTelemetry wrapper → Zod inputSchema validation → handler → return content
```
Every tool call creates an OTel span in `tool_calls`. SSE broadcasts to dashboard on mutation.

**Cloud sync flow (share → pull):**
```
cordenar_share → server.js → sync.js shareSynapses →
  embedding.js createEmbedding → Supabase REST POST → pending_approval
cordenar_pull → sync.js pullSynapses → paginate 500/batch →
  Supabase REST GET (all statuses) → INSERT/UPSERT local synapses.db →
  FTS5+vec0 sync → cleanup sweep (mark removed)
cordenar_sync → fullSync → sequential share → pull (per-node)
```

**Backup flow:**
```
Hourly timer / write-count threshold → doBackup →
  data_version dedup → VACUUM INTO → verifyBackup (row-count check) →
  writeCount=0 → enforceRetention (GFS-lite mtime bucketing)
```

### 4.3 Deployment View (AV-04)

```
┌─────────────────────────────────────────────┐
│  User machine (Linux / macOS / WSL)         │
│                                             │
│  npm install -g cordenar                    │
│  ~/.nvm/.../bin/cordenar → index.js         │
│  ~/.nvm/.../bin/cordenar-dashboard → dash.js│
│                                             │
│  ~/.cordenar/                               │
│  ├── synapses.db          (SQLite)          │
│  ├── backups/             (hourly VACUUM)   │
│  ├── auth.json            (multi-node)      │
│  └── config.json          (overrides)       │
│                                             │
│  systemd (optional):                         │
│  cordenar.service → journalctl logging       │
└─────────────────────────────────────────────┘
```

## 5. Architectural Decisions

### Decision SAD-01: Local-first SQLite with FTS5+vec0 hybrid search

- **Status:** Accepted
- **Decision:** Store all memories and concepts in a local SQLite database (`synapses.db`) with FTS5 full-text search and vec0 vector embeddings for hybrid retrieval. Zero cloud dependency at query time.
- **Rationale:** Local-first guarantees offline availability, sub-millisecond query latency, and data sovereignty. SQLite's single-file architecture simplifies backup (VACUUM INTO). FTS5 provides keyword search; vec0 provides semantic/typo-tolerant search via Murmur3 embeddings.
- **Alternatives considered:** PostgreSQL (requires server process, heavier), LanceDB (separate binary, less mature), pure FTS5 only (no semantic search), API-based embeddings (cloud dependency, latency, cost).
- **Consequences:** Single-writer concurrency (acceptable for single-user MCP). No distributed query capability.

### Decision SAD-02: MCP stdio transport

- **Status:** Accepted
- **Decision:** Primary interface is JSON-RPC over stdin/stdout (MCP stdio transport). No HTTP server for MCP tools.
- **Rationale:** Stdio is the MCP standard transport — zero network configuration, works across all MCP hosts (OpenCode, Cursor, VS Code, Claude Desktop), no port conflicts. The MCP spec's primary model.
- **Alternatives considered:** HTTP/SSE transport (port binding, CORS, TLS — unnecessary for local tool).
- **Consequences:** Process lifecycle tied to MCP client. Dashboard runs on a separate HTTP port (3458) for the web UI only.

### Decision SAD-03: better-sqlite3 (synchronous)

- **Status:** Accepted
- **Decision:** Use `better-sqlite3` (synchronous C++ addon) over `node:sqlite` (async built-in).
- **Rationale:** Synchronous API simplifies CRUD and backup logic (no async/await chains for DB ops). `better-sqlite3` has mature support for custom functions, PRAGMAs, and `VACUUM INTO`. Performance is equivalent for single-user workloads.
- **Alternatives considered:** node:sqlite (Node 22 built-in, async — unnecessary complexity), sql.js (WebAssembly, slower).
- **Consequences:** Native addon requires compilation on install. Not portable to non-Node runtimes (Bun, Deno).

### Decision SAD-04: FTS5 + vec0 hybrid retrieval

- **Status:** Accepted
- **Decision:** Combine full-text search (FTS5) with vector search (vec0, sqlite-vec extension) using a blended score. FTS5 provides exact keyword matching; vec0 provides semantic similarity via Murmur3 embeddings.
- **Rationale:** Neither FTS5 nor vec0 alone is sufficient. FTS5 misses typos and semantic context. vec0 alone matches irrelevant noise. Hybrid gives the best of both: recall from vec0 + precision from FTS5. The `requireFtsMatch` parameter gates vec-only results to avoid noise.
- **Alternatives considered:** FTS5 only (no typo tolerance), vec0 only (noisy), trigram tokenizer (substring matching only, not fuzzy), external embedding API (cost, latency, vendor lock-in).
- **Consequences:** sqlite-vec extension must be loaded at runtime. vec0 index rebuilds on concept reindex.

### Decision SAD-05: Murmur3 hash embeddings (deterministic, local)

- **Status:** Accepted
- **Decision:** Generate 256-dim embeddings using MurmurHash3, a deterministic non-cryptographic hash. Run entirely locally; no API calls.
- **Rationale:** Deterministic hashing means the same text always produces the same vector (idempotent across nodes), eliminating embedding drift. Zero cost, zero latency, zero vendor dependency. Sufficient for semantic similarity at Cordenar's scale.
- **Alternatives considered:** OpenAI embeddings API (cost, latency, non-deterministic), local ML model (heavier, maintenance burden), random vectors (useless).
- **Consequences:** Embeddings are not semantically "trained" — rely on cosine distance of hash bits. Works well in practice for typo tolerance and related-content retrieval.

### Decision SAD-06: GFS-lite time-based backup retention

- **Status:** Accepted
- **Decision:** Backups run hourly (and on write-count threshold) via `VACUUM INTO`. Retention uses a GFS-lite policy: keep all backups ≤24h, newest per day (30d), per week (12w), per month (12m). Age bucketing uses file mtime. Empty backups rejected via row-count comparison.
- **Rationale:** Count-based retention (keep last N) gives a weak recovery window (~10 hours with hourly cadence). GFS provides calendar-anchored recovery: recent granularity + long-term sparse. mtime is more robust than filename parsing.
- **Alternatives considered:** Count-based keep-10 (weak), days-only age-based (no monthly anchoring), unbounded (disk bloat).
- **Consequences:** ~78 files worst-case (~1 GB at 12 MB/backup). Typo in backup prefix (`cordernar-` vs `cordenar-`) was a critical bug in commit 50e4394 — fixed by extracting `BACKUP_PREFIX` constant.

### Decision SAD-07: Basecoat + Tailwind v4 CDN (dashboard)

- **Status:** Accepted
- **Decision:** The local web dashboard uses Basecoat (component library) with Tailwind v4 CDN runtime. No build step — plain HTML with `<script type="module">` ES imports.
- **Rationale:** Eliminates build tooling for the dashboard (no Vite, no node_modules bloat in the MCP package). Basecoat provides pre-built components (btn, dialog, select). Tailwind v4 CDN compiles utilities on-the-fly from HTML class strings. Hot-reloadable — edit `index.html` and refresh.
- **Alternatives considered:** React + Vite + shadcn (used for the cloud dashboard — requires build step, heavier), plain CSS (no component system), Bootstrap (larger, less flexible).
- **Consequences:** No TypeScript in the dashboard (plain JS). CSS is runtime-compiled (slight latency on first load). Basecoat's `data-variant` is a no-op for styling (layouts only; utilities provide visual styles).

### Decision SAD-08: Dashboard ES modules (from IIFE)

- **Status:** Accepted
- **Decision:** The dashboard JavaScript was refactored from a single 1092-line IIFE into 5 ES modules (`state.js`, `ui.js`, `api.js`, `events.js`, `main.js`) with `'use strict'`, cached DOM lookups, and `var`→`const/let`.
- **Rationale:** ES modules provide proper scoping (no implicit globals), enable selective imports, and align with modern MCP tool conventions. The refactoring fixed bugs: `syncThemeBtn` moved to `state.js`, `previewHistory`/`Forward`/`NavVersion` and `searchTimer` moved into the `state` object to avoid read-only import binding errors.
- **Alternatives considered:** Keep IIFE (bug-prone, no scoping), CommonJS (not browser-compatible), bundler (adds build step).
- **Consequences:** Dashboard loads as `<script type="module">`. No IE support (acceptable).

## 6. Constraints and Assumptions

**Constraints:**
- Node.js ≥18 (better-sqlite3 native addon, ES modules).
- sqlite-vec extension available (`vec0` virtual table). Gracefully skips if not loaded.
- Single-writer concurrency (SQLite). No multi-process access to `synapses.db`.
- MCP stdio transport requires the host to launch Cordenar as a child process.

**Assumptions:**
- The user's machine has a writable `~/.cordenar/` directory.
- AI agents consume Cordenar via MCP stdio with ~1 KB tool descriptions.
- Cloud sync is optional; the system operates fully offline without it.
- Hourly backups provide acceptable RPO (~1 hour).

## 7. Risks and Mitigations

| Risk ID | Description | Impact | Mitigation |
|---|---|---|---|
| R-01 | SQLite DB corruption | High — data loss | Hourly VACUUM INTO backups + verifyBackup row-count rejection + integrity_check on startup |
| R-02 | Cloud sync conflict (concurrent push from two nodes) | Med — overwrite | pending_approval gate + cloud_status tracking + orphan detection |
| R-03 | Embedding drift (different Murmur3 implementations) | Low — search degradation | Deterministic MurmurHash3 (no API variance) + vec_score contribution controlled by alpha |
| R-04 | sqlite-vec extension not available | Low — vec0 search disabled | Graceful fallback: VEC_AVAILABLE flag, vec0 queries skipped |
| R-05 | Dashboard port (3458) conflict | Low — dashboard inaccessible | Configurable via CORDENAR_PORT env var |
| R-06 | Typo-class bugs in string constants | Low — features silently break | BACKUP_PREFIX constant extraction (post-50e4394 fix); no remaining duplicated prefix strings |

## 8. Architecture Coverage Mapping

| Architecture Item | Requirement IDs | Coverage Note |
|---|---|---|
| SAD-01 (local-first SQLite) | All feature FRs (storage layer) | Foundation for all data operations |
| SAD-02 (stdio transport) | MCP spec compliance | Interface to all tools |
| SAD-03 (better-sqlite3) | Backup/recovery FRs | Synchronous API enables simple backup logic |
| SAD-04 (hybrid search) | Retrieval FRs (memory_search, concept_search) | Enables typo tolerance + keyword precision |
| SAD-05 (Murmur3 embeddings) | Retrieval FRs, sync FRs | Deterministic across nodes |
| SAD-06 (GFS-lite retention) | Backup FRs | Calendar-anchored recovery window |
| SAD-07 (Basecoat dashboard) | Dashboard HTTP API | Zero-build dashboard delivery |
| SAD-08 (ES modules) | Dashboard responsiveness | Proper scoping + bug fixes |

## 9. Architecture Readiness Summary

- [x] All major decisions traced to requirement areas
- [x] No major architecture decision left undocumented
- [x] Risks documented for critical decisions
- [x] No placeholder left in mandatory sections

## 10. Handoff

**Next implementation skill(s):** Per-feature SRS documents (see individual feature directories under `docs/`).

**Architecture handoff notes:**
- System-level ADRs (SAD-01 through SAD-08) are authoritative for all features.
- Feature architectures should reference system SADs rather than re-state them.
- Container responsibilities are the decomposition base for feature boundaries.

## 11. Document Control

- **Version:** 1.0
- **Status:** Draft
- **Author:** Hector Jarquin
- **Last Updated:** 2026-09-25

## Related

- [Platform Operations](./platform.md)
- [Documentation Index](./index.md)
