---
type: Specification
title: Software Requirements Specification (SRS): Backup
description: Software requirements for the backup feature of Cordenar MCP.
tags: [backup, specification, requirements]
timestamp: 2026-09-25T00:00:00Z
---

# Software Requirements Specification (SRS): Backup

**Standard:** ISO/IEC/IEEE 29148:2018

## 1. Introduction

Backup durability layer. Hourly SQLite snapshots with GFS-lite time-based retention, verification against empty copies, and startup freshness check.

### 3.1 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | The software MUST run `doBackup` on an hourly timer independent of the dashboard process. | Must |
| FR-02 | The software MUST trigger `doBackup` when `writeCount >= backup.intervalWrites` (default 50) via `recordWrite`. | Must |
| FR-03 | The software MUST run `doBackup` on startup if the latest backup is older than `backup.freshnessHours` (default 1) or missing. | Must |
| FR-04 | The software MUST skip `doBackup` when `data_version` is unchanged (dedup) to avoid redundant snapshots. | Must |
| FR-05 | The software MUST create snapshots via `VACUUM INTO` to `backup.dir` with filename `cordenar-<ISO-ts>-<millis>.db`. | Must |
| FR-06 | The software MUST enforce GFS-lite retention: keep all backups ≤ `retention.recentHours` (24h), newest per day (`dailyDays` 30), per week (`weeklyWeeks` 12), per month (`monthlyMonths` 12). Delete all older/unkept files. | Must |
| FR-07 | The software MUST use file mtime (not filename) for age bucketing in retention. | Must |
| FR-08 | The software MUST verify each backup after VACUUM INTO via row-count comparison. If source has rows but backup has 0, MUST reject (unlink + warn) and reset `writeCount` without updating `lastDataVersion`. | Must |
| FR-09 | The software MUST run `enforceRetention` on startup, independent of `doBackup`, so pruning happens even when no new backup is needed. | Must |
| FR-10 | The software MUST use a shared `BACKUP_PREFIX` constant ('cordenar-') for both writing and filtering backup files (prevents typo-class bugs). | Must |

### 3.6 States

| State | Trigger |
|---|---|
| Fresh | Latest backup < freshnessHours old |
| Stale | Latest backup ≥ freshnessHours old → doBackup on startup |

### 3.8 Data Management

Backup files: `cordenar-YYYY-MM-DD-HH-MM-SS-<millis>.db` in `~/.cordenar/backups/`. Each is a full SQLite snapshot (~12 MB). Worst-case ~78 retained files (~1 GB).

### 3.9 Compliance

Config via env vars: `BACKUP_DIR`, `BACKUP_INTERVAL_WRITES`, `BACKUP_RETENTION_RECENT_HOURS`, `BACKUP_RETENTION_DAILY_DAYS`, `BACKUP_RETENTION_WEEKLY_WEEKS`, `BACKUP_RETENTION_MONTHLY_MONTHS`, `CORDENAR_BACKUP_FRESHNESS_HOURS`.

## 4. Verification

Backup trigger tests + retention pruning tests (see testing/feature). Verified live: 634 stale files pruned to ~30 on next run.

## 6. Appendices

### 6.1 Decisions Log
- 2026-08-22: Fixed typo (`cordernar-` vs `cordenar-`) — retention never ran. Extracted `BACKUP_PREFIX`. Commit b504df1.
- 2026-08-22: GFS-lite retention (commit b504df1). Empty-backup verification via row-count comparison.

## Related

- [Architecture](./backup-architecture.md)
- [Developer Documentation](./backup-developer-documentation.md)
- [System Architecture](../architecture.md)
