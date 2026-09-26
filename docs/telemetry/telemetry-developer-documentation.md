---
type: DeveloperReference
title: Developer Documentation: Telemetry
description: Developer reference and tool documentation for the telemetry feature of Cordenar MCP.
tags: [telemetry, developer, api]
timestamp: 2026-09-25T00:00:00Z
---

# Developer Documentation: Telemetry

**Standard:** ISO/IEC/IEEE 26514:2022

## Overview

OTel observability for the Cordenar MCP server. The `tool_usage` tool reports usage statistics aggregated from the `tool_calls` table.

## Tool Reference

### tool_usage

**Description:** Report tool call usage statistics for a given period.

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| period | string | No | 7d | Aggregation window: `24h`, `7d`, `30d`, `all` |

**Returns:** Usage statistics — per-tool call counts, share percentages, and success rates.

**Example:**
```
tool_usage { period: "7d" }
```

## Integration

- Every MCP tool call records a span in `tool_calls`.
- Dashboard API requests record spans named `http:METHOD:/api/path`.
- `tool_usage` aggregates the `tool_calls` table.

## Traceability
- [SRS: FR-04] tool_usage

## Document Control
- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./telemetry-srs.md)
- [Architecture](./telemetry-architecture.md)
- [System Architecture](../architecture.md)
