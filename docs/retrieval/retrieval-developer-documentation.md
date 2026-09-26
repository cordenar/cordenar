---
type: DeveloperReference
title: Developer Documentation: Retrieval
description: Developer reference and tool documentation for the retrieval feature of Cordenar MCP.
tags: [retrieval, developer, api]
timestamp: 2026-09-25T00:00:00Z
---

# Developer Documentation: Retrieval

**Standard:** ISO/IEC/IEEE 26514:2022

## Overview

`get` and `related` provide cross-entity synapse detail and relationship navigation, keyed by cloud UUID.

## Tool Reference

### get

**Parameters:** `synapse_id` (string, required) — cloud UUID.

**Returns:** Full synapse row (content, metadata, type, status).

**Example:**
```
cordenar_get { synapse_id: "f81b26e6-f4b0-4e19-a770-b6736190847c" }
```

### related

**Parameters:** `synapse_id` (string, required) — cloud UUID.

**Returns:** Array of related synapses. Memories → `related_ids`. Concepts → full family (ancestors + immediate siblings + descendants + declared dependencies).

**Example:**
```
cordenar_related { synapse_id: "f81b26e6-f4b0-4e19-a770-b6736190847c" }
```

## Traceability
- [SRS: FR-01] get
- [SRS: FR-02, FR-03] related

## Document Control
- **Version:** 1.0 | **Status:** Draft | **Last Updated:** 2026-09-25

## Related

- [SRS](./retrieval-srs.md)
- [Architecture](./retrieval-architecture.md)
- [System Architecture](../architecture.md)
