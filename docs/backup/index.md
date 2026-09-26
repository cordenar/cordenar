# Backup — Cordenar MCP

The backup durability layer provides hourly SQLite snapshots with GFS-lite time-based retention. Snapshots use `VACUUM INTO` with data-version dedup, verification against empty copies, and calendar-anchored pruning.

**MCP tools:** None (operational subsystem — `doBackup`, `enforceRetention`, `verifyBackup`, `recordWrite` in db.js).

## Documents

- [Backup SRS](./backup-srs.md) — FRs for snapshot triggers, retention policy, verification (ISO 29148)
- [Backup Architecture](./backup-architecture.md) — doBackup/enforceRetention/verifyBackup, ADRs (ISO 42010)
- [Backup Developer Documentation](./backup-developer-documentation.md) — Config reference, restore guide (ISO 26514)
