---
type: Architecture
title: Architecture Description: Auth
description: Architecture description and ADRs for the auth feature of Cordenar MCP.
tags: [auth, architecture, adr]
timestamp: 2026-09-25T00:00:00Z
---

# Architecture Description: Auth

**Standard:** ISO/IEC/IEEE 42010:2022

## 1. Purpose

Architecture of the authentication system — multi-node identity management, Supabase GoTrue integration, auth.json persistence, and token lifecycle.

## 2. Stakeholders

| Stakeholder | Concern | Priority |
|---|---|---|
| AI agents (MCP) | Auth before sync, node switching | High |
| Hector Jarquin (maintainer) | Credential safety, multi-node correctness | High |

## 3. Architecture Views

### 3.1 Container View

| Component | File | Responsibility |
|---|---|---|
| auth.js | auth.js | Multi-node CRUD (saveAuth, loadAuth, switchActiveNode, findNode, removeNode, clearAuth) |
| supabase.js | supabase.js | Token refresh, Supabase client per node, needs_reauth flag |
| server.js | server.js | 4 tool registrations (auth, deauth, status, list_accounts) |

### 3.2 Runtime View

**Auth register:** MCP → server.js → auth.js → fetch(cloudUrl/api/auth/node, {client_secret, client_id}) → GoTrue JWT → decode → saveAuth(multi-node array).

**Multi-node:** auth.json stores `{active_node_id, nodes: [{node_id, access_token, account_slug, ...}]}`. `switchActiveNode(accountSlug)` sets `active_node_id`; `removeNode` clears it when the active node is removed; `getActiveNode()` returns `null` when the pointer doesn't resolve (no silent fallback). `sync` iterates all nodes.

## 4. Architectural Decisions

### Decision AD-01: Multi-node array format in auth.json

- **Status:** Accepted
- **Decision:** `auth.json` stores an array of nodes with `active_node_id` pointer instead of single-node flat format.
- **Rationale:** A single Cordenar instance may authenticate with multiple organizations. Array format enables node switching without re-authentication.
- **Traceability:** FR-01, FR-03

### Decision AD-03: Bot credential auth via GoTrue

- **Status:** Accepted
- **Decision:** Node authentication uses `POST /api/auth/node` with `client_secret` + `client_id` (hostname-username). The cloud creates a bot user via Supabase GoTrue's `add_account_member` RPC with `service_role` bypass.
- **Rationale:** No user-facing OAuth flow for MCP nodes. Bot accounts are machine identities, not human users. `service_role` bypass allows the cloud to register bots without user interaction.
- **Traceability:** FR-01

## 5. Risks

| Risk ID | Description | Mitigation |
|---|---|---|
| R-01 | Token expiry breaking sync | Token refresh in supabase.js; needs_reauth flag |
| R-02 | auth.json corruption | JSON parse guard; falls back to empty default |

## 6. Document Control

- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./auth-srs.md)
- [Developer Documentation](./auth-developer-documentation.md)
- [System Architecture](../architecture.md)
