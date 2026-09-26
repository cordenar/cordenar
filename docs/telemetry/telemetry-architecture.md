---
type: Architecture
title: Architecture Description: Telemetry
description: Architecture description and ADRs for the telemetry feature of Cordenar MCP.
tags: [telemetry, architecture, adr]
timestamp: 2026-09-25T00:00:00Z
---

# Architecture Description: Telemetry

**Standard:** ISO/IEC/IEEE 42010:2022

## 1. Purpose

OpenTelemetry observability. Spans from MCP tools and dashboard API requests are recorded in the `tool_calls` table and surfaced via `tool_usage`.

## 2. ADRs

### Decision AD-01: withTelemetry wrapper (per-tool span)

- **Status:** Accepted
- **Decision:** Every tool handler is wrapped with `withTelemetry(toolName, handler)`, which creates one OTel span per tool call and records it to `tool_calls`.
- **Traceability:** FR-01, FR-02

### Decision AD-02: http:METHOD:/path span naming for dashboard

- **Status:** Accepted
- **Decision:** Dashboard API spans use `http:METHOD:/api/path` naming (e.g., `http:GET:/api/dashboard`) to distinguish from MCP tool spans (e.g., `memory_store`).
- **Traceability:** FR-03

### Decision AD-03: 30-day retention on tool_calls

- **Status:** Accepted
- **Decision:** `tool_calls` rows older than `CORDENAR_TOOL_RETENTION_DAYS` (default 30) are pruned via `DELETE FROM tool_calls WHERE called_at < ?`.
- **Traceability:** FR-05

## Related

- [SRS](./telemetry-srs.md)
- [Developer Documentation](./telemetry-developer-documentation.md)
- [System Architecture](../architecture.md)
