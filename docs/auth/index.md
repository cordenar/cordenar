# Auth — Cordenar MCP

Authentication and multi-node identity management for the Cordenar MCP server. Supports registering multiple cloud accounts (nodes), switching active node, and credential persistence in `~/.cordenar/auth.json`.

**MCP tools:** auth, deauth, status, list_accounts (4 tools).

## Documents

- [Auth SRS](./auth-srs.md) — FRs for register, deauth, status, list accounts (ISO 29148)
- [Auth Architecture](./auth-architecture.md) — Multi-node store, Supabase GoTrue, bot credential flow (ISO 42010)
- [Auth Developer Documentation](./auth-developer-documentation.md) — Tool reference, multi-node guide (ISO 26514)
