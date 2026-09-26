---
type: Specification
title: Software Requirements Specification (SRS): Telemetry
description: Software requirements for the telemetry feature of Cordenar MCP.
tags: [telemetry, specification, requirements]
timestamp: 2026-09-25T00:00:00Z
---

# Software Requirements Specification (SRS): Telemetry

**Standard:** ISO/IEC/IEEE 29148:2018

## 1. Introduction

OTel-based observability. Every tool call and dashboard API request creates a span in the `tool_calls` table.

### 3.1 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | The software MUST wrap every MCP tool handler with `withTelemetry`, creating an OTel span named after the tool. | Must |
| FR-02 | The software MUST record tool call spans to the `tool_calls` table with columns: tool name, error type, timestamp, and environment. | Must |
| FR-03 | The software MUST instrument dashboard API routes (3 entry points: /api/sync, /api/notify, handleApi) with spans named `http:METHOD:/api/path`; these spans are recorded but excluded from aggregated tool usage statistics. | Must |
| FR-04 | The software MUST execute `tool_usage` to report aggregated tool usage statistics for a given period (24h, 7d, 30d, all). | Must |
| FR-05 | The software MUST retain tool_calls telemetry for `CORDENAR_TOOL_RETENTION_DAYS` (default 30) before pruning. | Must |
| FR-06 | The software MUST flush telemetry spans on graceful shutdown (`forceFlushTelemetry`). | Must |

### 3.8 Data Management

`tool_calls` table: tool name, error type, timestamp, environment.

### 4. Verification

Span naming convention tests + dashboard API span tests (test/cordenar.test.mjs).

## Related

- [Architecture](./telemetry-architecture.md)
- [Developer Documentation](./telemetry-developer-documentation.md)
- [System Architecture](../architecture.md)
