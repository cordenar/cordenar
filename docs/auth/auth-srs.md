---
type: Specification
title: Software Requirements Specification (SRS): Auth
description: Software requirements for the auth feature of Cordenar MCP.
tags: [auth, specification, requirements]
timestamp: 2026-09-25T00:00:00Z
---

# Software Requirements Specification (SRS): Auth

**Standard:** ISO/IEC/IEEE 29148:2018

## Document Information

| Field | Value |
|---|---|
| Project | Cordenar MCP |
| Software Component | Auth — authentication and multi-node identity |
| Version | 1.0 — Draft |
| Author | Hector Jarquin |
| Status | Draft |

---

## 1. Introduction

### 1.1 System Purpose

The Auth feature provides node credential authentication with Cordenar Cloud via Supabase GoTrue, multi-node identity management, and account listing.

### 1.2 System Overview

Three modes of `cordenar_auth`:
- No params → list all registered nodes and the active node.
- `account_slug` only → switch active node.
- `client_secret` → register/authenticate a new node with the cloud.

---

## 3. Software Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | The software MUST execute `auth` with three modes: no-params (list nodes + active), `account_slug`-only (switch), `client_secret`-provided (register). When registering, MUST call the cloud's `POST /api/auth/node` with `client_secret` and `client_id` (hostname-username). MUST persist credentials to `auth.json` in a multi-node array format. | Must |
| FR-02 | The software MUST execute `deauth` to remove authentication credentials for a specific account (by `account_slug`) or all accounts. MUST clear the local `auth.json` file. | Must |
| FR-03 | The software MUST execute `status` to display current auth state: node ID, account name, pending push count, un-pulled synapse count, last sync time, active node, all registered nodes. | Must |
| FR-04 | The software MUST execute `list_accounts` to query the cloud for all Basejump accounts the authenticated user belongs to. Returns account_id, name, slug, and role for each. | Must |
| FR-05 | The software MUST support token refresh via Supabase GoTrue. If token refresh fails, MUST mark the node as `needs_reauth`. | Must |

### 3.4 Software Interfaces

| Tool | Params | Output |
|---|---|---|
| auth | client_secret? string, account_slug? string | Node list + active (no params), `{switched}` (switch), `{node_id, account_id}` (register) |
| deauth | account_slug? string (empty = remove all) | Confirmation |
| status | — | Auth state JSON with node details, counts, sync time |
| list_accounts | — | Array of `{account_id, name, slug, role}` |

### 3.5 Software Operations

**Auth register flow:** MCP → auth.js → fetch(`${cloudUrl}/api/auth/node`, {client_secret, client_id}) → GoTrue JWT → decode payload (sub = user_id) → saveAuth({node_id, access_token, account_id, name}) → multi-node array format.

### 3.6 Security

| ID | Requirement |
|---|---|
| SEC-01 | Auth credentials MUST be stored in `~/.cordenar/auth.json` with file permissions restricted to the user. |
| SEC-02 | `client_secret` MUST NOT appear in tool outputs or logs. |
| SEC-03 | Token expiry MUST trigger refresh or mark `needs_reauth`. |

### 3.8 Data Management

`auth.json` format (multi-node array):
```json
{
  "active_node_id": "uuid",
  "nodes": [
    { "node_id": "uuid", "access_token": "jwt", "account_id": "uuid",
      "name": "str", "account_name": "str", "account_slug": "str",
      "user_id": "str", "account_role": "str",
      "is_primary_owner": false, "accounts": [], "capabilities": [] }
  ]
}
```

## 4. Verification

Auth module tests: test/cordenar.test.mjs Phase 1 (16 tests) — loadAuth, saveAuth, switchActiveNode, findNode, removeNode, clearAuth.

## 5. Traceability

| SRS FR | Test |
|---|---|
| FR-01, FR-02, FR-03, FR-04 | Phase 1 Auth module (16 tests) |

## Related

- [Architecture](./auth-architecture.md)
- [Developer Documentation](./auth-developer-documentation.md)
- [System Architecture](../architecture.md)
