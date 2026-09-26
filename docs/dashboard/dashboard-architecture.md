---
type: Architecture
title: Architecture Description: Dashboard
description: Architecture description and ADRs for the dashboard feature of Cordenar MCP.
tags: [dashboard, architecture, adr]
timestamp: 2026-09-25T00:00:00Z
---

# Architecture Description: Dashboard

**Standard:** ISO/IEC/IEEE 42010:2022

## 1. Purpose

Architecture of the local web dashboard — an HTTP server + client-side SPA using Basecoat + Tailwind v4 CDN.

## 2. Container View

| Component | File(s) | Responsibility |
|---|---|---|
| HTTP server | dashboard.js | Node http server, route dispatch, API handler |
| API handler | dashboard/api-handler.js | All /api/* route implementations |
| UI (modules) | public/src/ | 5 ES modules: state.js, ui.js, api.js, events.js, main.js |
| Static files | public/ | index.html, style.css, tokens.css, basecoat-*, tailwind-v4.js |

## 3. ADRs

### Decision AD-01: Basecoat + Tailwind v4 CDN (zero build)

- **Status:** Accepted
- **Decision:** Dashboard uses Basecoat components and Tailwind v4 CDN runtime. No Vite/React build step. Editable plain HTML + JS.
- **Rationale:** Eliminates build tooling from the MCP package. Dashboard loads as static files from `dashboard/public/`.
- **Traceability:** SAD-07

### Decision AD-02: ES modules refactor (from IIFE)

- **Status:** Accepted
- **Decision:** Dashboard JS refactored from monolithic IIFE into 5 ES modules with `'use strict'`, `var`→`const/let`, cached DOM lookups.
- **Traceability:** SAD-08

### Decision AD-03: SSE with 30s polling fallback

- **Status:** Accepted
- **Decision:** Real-time updates via `EventSource('/api/events')` with a 30-second polling interval as fallback for CLOSED connections.
- **Rationale:** SSE provides sub-second push for mutations. 30s fallback covers connection errors without manual refresh.

## 4. Risks

| Risk | Mitigation |
|---|---|
| Port 3458 conflict | `CORDENAR_PORT` env var override |
| SSE connection limits (100 concurrent) | Acceptable; dashboard is local single-user |

## Related

- [SRS](./dashboard-srs.md)
- [Developer Documentation](./dashboard-developer-documentation.md)
- [System Architecture](../architecture.md)
