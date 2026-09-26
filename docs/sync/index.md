# Sync — Cordenar MCP

The Sync engine transports memories and concepts between the local SQLite database and Cordenar Cloud (Supabase). It manages the `synapse_map` tracking table, push/pull/unshare/governance lifecycle, multi-node routing, and orphan detection.

**MCP tools:** share, unshare, pull, sync (4 tools). Plus `list_accounts` (in auth).

## Documents

- [Sync SRS](./sync-srs.md) — FRs for push, pull, unshare, sync, governance (ISO 29148)
- [Sync Architecture](./sync-architecture.md) — Push/pull flow, synapse_map, ADRs (ISO 42010)
- [Sync Developer Documentation](./sync-developer-documentation.md) — Tool reference, cloud integration guide (ISO 26514)
