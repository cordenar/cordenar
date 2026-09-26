---
type: Architecture
title: Architecture Description: Backup
description: Architecture description and ADRs for the backup feature of Cordenar MCP.
tags: [backup, architecture, adr]
timestamp: 2026-09-25T00:00:00Z
---

# Architecture Description: Backup

**Standard:** ISO/IEC/IEEE 42010:2022

## 1. Purpose

Backup durability: hourly VACUUM INTO snapshots with GFS-lite retention, verification, and startup freshness.

## 2. Container View

| Component | Function | File |
|---|---|---|
| doBackup | VACUUM INTO snapshot + data-version dedup | db.js |
| enforceRetention | GFS-lite mtime-bucketed pruning | db.js |
| verifyBackup | Row-count comparison; rejects empty copies | db.js |
| recordWrite | Write-count threshold trigger (10 call sites) | db.js |
| Timer | Hourly setInterval | server.js |

## 3. Runtime View

```
Hourly timer / recordWrite (≥50 writes) → doBackup
  → data_version dedup (skip if unchanged)
  → VACUUM INTO 'cordenar-<ts>.db'
  → verifyBackup (row-count comparison)
  → writeCount=0, lastDataVersion=currentVersion
  → enforceRetention (GFS-lite)
```

Startup: initDb → freshness check (latest backup mtime vs freshnessHours) → doBackup if stale → enforceRetention.

## 4. ADRs

### Decision AD-01: GFS-lite time-based retention

- **Status:** Accepted
- **Decision:** Keep all backups ≤24h; newest per day (30d), per week (12w), per month (12m). mtime-bucketed. Delete the rest.
- **Rationale:** Count-based "keep 10" gave only ~10 hours of recovery. GFS provides calendar-anchored recovery. mtime is more robust than filename parsing.
- **Alternatives:** count-based (weak), days-only age (no monthly anchor), unbounded (disk bloat).
- **Traceability:** FR-06, FR-07

### Decision AD-02: VACUUM INTO over file copy

- **Status:** Accepted
- **Decision:** Snapshots via SQLite `VACUUM INTO` (consistent, compacted) rather than raw file copy.
- **Rationale:** VACUUM INTO produces a defragmented, integrity-checked snapshot in one atomic statement.
- **Traceability:** FR-05

### Decision AD-03: Empty-backup verification (row-count comparison)

- **Status:** Accepted
- **Decision:** After VACUUM INTO, open the backup read-only and compare memories+concepts row counts to source. Reject if source has rows but backup has 0. On rejection: reset writeCount, leave lastDataVersion unchanged (retry).
- **Rationale:** VACUUM INTO can silently produce empty files during migration/reset/races. A "successful" empty backup is a data-loss trap.
- **Traceability:** FR-08

### Decision AD-04: BACKUP_PREFIX constant

- **Status:** Accepted
- **Decision:** Extract `const BACKUP_PREFIX = 'cordenar-'` used in write + filter + startup check. Single source of truth.
- **Rationale:** The `cordernar-` (two n) vs `cordenar-` (one n) typo broke retention silently (634 files, 9.7 GB). A shared constant prevents the bug class.
- **Traceability:** FR-10

## 5. Risks

| Risk | Mitigation |
|---|---|
| Empty VACUUM INTO (silent empty backup) | verifyBackup row-count rejection |
| Typo-class bugs in prefix | BACKUP_PREFIX constant |
| Unbounded accumulation | enforceRetention on startup + after backup |

## 6. Document Control
- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./backup-srs.md)
- [Developer Documentation](./backup-developer-documentation.md)
- [System Architecture](../architecture.md)
