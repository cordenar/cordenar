---
type: DeveloperReference
title: Developer Documentation: Backup
description: Developer reference and tool documentation for the backup feature of Cordenar MCP.
tags: [backup, developer, api]
timestamp: 2026-09-25T00:00:00Z
---

# Developer Documentation: Backup

**Standard:** ISO/IEC/IEEE 26514:2022

## Overview

Hourly SQLite snapshots with GFS-lite time-based retention. Snapshots are created via `VACUUM INTO`, verified against empty copies, and pruned by calendar-anchored age buckets.

## Configuration

| Env Var | Default | Description |
|---|---|---|
| BACKUP_DIR | ~/.cordenar/backups | Snapshot directory |
| BACKUP_INTERVAL_WRITES | 50 | Writes before triggering a backup |
| BACKUP_RETENTION_RECENT_HOURS | 24 | Keep all backups within this window |
| BACKUP_RETENTION_DAILY_DAYS | 30 | Keep newest per day |
| BACKUP_RETENTION_WEEKLY_WEEKS | 12 | Keep newest per week |
| BACKUP_RETENTION_MONTHLY_MONTHS | 12 | Keep newest per month |
| CORDENAR_BACKUP_FRESHNESS_HOURS | 1 | Startup backup if latest older than this |

## Retention Policy (GFS-lite)

| Tier | Keep |
|---|---|
| Recent (≤24h) | everything |
| Daily (30d) | newest per calendar day |
| Weekly (12w) | newest per week |
| Monthly (12m) | newest per calendar month |
| Older | delete |

## Restore Guide

Snapshots are full SQLite files. To restore:

```bash
# 1. Stop the MCP server (dashboard + any MCP host)
cordenar-dashboard stop

# 2. Copy the desired snapshot over the live DB
cp ~/.cordenar/backups/cordenar-2026-08-21-*.db ~/.cordenar/synapses.db

# 3. Restart
cordenar-dashboard
```

## Troubleshooting

### Issue: Backup directory accumulating files

**Cause:** Retention not running (or old code before BACKUP_PREFIX fix).
**Solution:** Ensure commit b504df1+ is installed. Run the dashboard — startup `enforceRetention` prunes stale files.

### Issue: Restore produces empty DB

**Cause:** Restored a rejected/empty snapshot (4-12 KB file).
**Solution:** Choose a full-sized (~12 MB) snapshot. Empty snapshots are rejected by verifyBackup but may persist from older versions.

## Traceability
- [SRS: FR-01 through FR-10]

## Document Control
- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./backup-srs.md)
- [Architecture](./backup-architecture.md)
- [System Architecture](../architecture.md)
