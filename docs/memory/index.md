# Memory — Cordenar MCP

The Memory feature is the core knowledge store of Cordenar. It persists memories (facts, decisions, bugs, plans, notes, progressive summaries) in a local SQLite database with FTS5+vec0 hybrid search, lifecycle management, and project scoping.

**MCP tools:** memory_search, memory_list, memory_context, memory_store, memory_get, memory_update, memory_trash, memory_restore, memory_purge, memory_archive, memory_unarchive, memory_reassign, memory_brief, memory_progressive_summary (14 tools).

## Documents

- [Memory SRS](./memory-srs.md) — 14 functional requirements, tool contracts, lifecycle states, data model (ISO 29148)
- [Memory Architecture](./memory-architecture.md) — Architecture views, ADRs, coverage mapping (ISO 42010)
- [Memory Developer Documentation](./memory-developer-documentation.md) — Tool reference, integration guide, examples (ISO 26514)
