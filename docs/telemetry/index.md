# Telemetry — Cordenar MCP

OpenTelemetry-based observability. Every MCP tool call and dashboard API request creates an OTel span recorded in the `tool_calls` table. The `tool_usage` tool aggregates and reports usage statistics.

**MCP tools:** tool_usage (1 tool).

## Documents

- [Telemetry SRS](./telemetry-srs.md) — FRs for span recording, tool_usage (ISO 29148)
- [Telemetry Architecture](./telemetry-architecture.md) — OTel pipeline, withTelemetry wrapper (ISO 42010)
- [Telemetry Developer Documentation](./telemetry-developer-documentation.md) — tool_usage reference (ISO 26514)
