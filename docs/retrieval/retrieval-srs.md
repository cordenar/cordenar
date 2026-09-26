---
type: Specification
title: Software Requirements Specification (SRS): Retrieval
description: Software requirements for the retrieval feature of Cordenar MCP.
tags: [retrieval, specification, requirements]
timestamp: 2026-09-25T00:00:00Z
---

# Software Requirements Specification (SRS): Retrieval

**Standard:** ISO/IEC/IEEE 29148:2018

## 1. Introduction

Cross-entity detail lookup and relationship navigation. `get` returns a single synapse by cloud UUID; `related` resolves related synapses — memories by explicit `related_ids`, concepts by their full relational family (ancestors + immediate siblings + descendants + declared dependencies).

### 3.1 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | The software MUST execute `get` to return full content and metadata of a specific local synapse by cloud UUID. Must look up both memory and concept stores. | Must |
| FR-02 | The software MUST execute `related` to resolve related synapses for a given synapse. For memories, resolves `related_ids`. For concepts, resolves the full relational family (ancestors + immediate siblings + descendants + declared dependencies) via `computeConceptFamily`. | Must |
| FR-03 | The software MUST return an empty or null result (not an error) when a synapse has no relationships. | Must |

### 3.4 Interfaces

| Tool | Params | Output |
|---|---|---|
| get | synapse_id (string) | Full synapse row with metadata |
| related | synapse_id (string) | Related synapse list (memories: related_ids; concepts: full family) |

## Related

- [Architecture](./retrieval-architecture.md)
- [Developer Documentation](./retrieval-developer-documentation.md)
- [System Architecture](../architecture.md)
