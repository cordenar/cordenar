---
type: DeveloperReference
title: Developer Documentation: Auth
description: Developer reference and tool documentation for the auth feature of Cordenar MCP.
tags: [auth, developer, api]
timestamp: 2026-09-25T00:00:00Z
---

# Developer Documentation: Auth

**Standard:** ISO/IEC/IEEE 26514:2022

## Overview

The Auth feature manages cloud authentication and multi-node identity for the Cordenar MCP server. A single Cordenar instance can authenticate with multiple Cordenar Cloud accounts (organizations), switch between them, and list accounts.

[SRS: FR-01 through FR-05]

---

## Tool Reference

### auth

**Description:** Three-in-one: list nodes (no params), switch active (account_slug only), or register (client_secret).

**Modes:**

| Mode | Params | Behavior |
|---|---|---|
| List | *(none)* | Returns all registered nodes with active indicator |
| Switch | `account_slug` | Switches active node; returns `{switched, node, account_name, account_slug}` |
| Register | `client_secret` | Authenticates with cloud; persists new node; returns `{node_id, account_id, name}` |

**Parameters (optional):**

| Name | Type | Description |
|---|---|---|
| client_secret | string | Supabase publishable key for new node registration |
| account_slug | string | Switch to this team/node (no client_secret) |

**Errors:** `client_secret is required` if `account_slug` is provided without a secret and the slug doesn't match any registered node.

[SRS: FR-01]

### deauth

**Description:** Remove stored authentication. With no params, removes all nodes. With `account_slug`, removes that specific node.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| account_slug | string | No | Remove specific node (omitting removes all) |

[SRS: FR-02]

### status

**Description:** Display current authentication state: active node, pending push count, un-pulled count, last sync time, and all registered nodes.

**Parameters:** None.

**Returns:** JSON object with node details, counts, and timestamps.

[SRS: FR-03]

### list_accounts

**Description:** Query the cloud for all Basejump accounts the authenticated user belongs to.

**Parameters:** None.

**Returns:** Array of `{account_id, name, slug, role}` objects.

[SRS: FR-04]

---

## Multi-node Guide

### Registering multiple organizations

```
cordenar_auth { client_secret: "sb_publishable_org1_..." }  → Node 1
cordenar_auth { client_secret: "sb_publishable_org2_..." }  → Node 2
cordenar_auth → shows both nodes
cordenar_auth { account_slug: "org1" } → switches to Node 1
```

### Checking status

```
cordenar_status → shows active node, pending push/pull counts, last sync
```

---

## Troubleshooting

### Issue: `auth` with client_secret returns error

**Cause:** Cloud URL not reachable or client_secret invalid.
**Solution:** Verify `CORDENAR_CLOUD_URL` config. Check Supabase is running.

### Issue: `deauth` doesn't clear credentials

**Cause:** auth.json write permission issue.
**Solution:** Check `~/.cordenar/` directory permissions.

---

## Traceability

- [SRS: FR-01] auth — multi-mode
- [SRS: FR-02] deauth — credential removal
- [SRS: FR-03] status — auth state display
- [SRS: FR-04] list_accounts — cloud account enumeration

## Document Control

- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./auth-srs.md)
- [Architecture](./auth-architecture.md)
- [System Architecture](../architecture.md)
