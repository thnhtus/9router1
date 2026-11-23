# Software Requirements Specification

## Document control

| Field | Value |
|---|---|
| System | 9Router (fork of decolua/9router) |
| Document | Extension roadmap SRS |
| Version | 0.1 (draft) |
| Date | 2026-11-23 |
| Status | Draft — for review |
| Standard | ISO/IEC/IEEE 29148:2018 (supersedes IEEE 830-1998) |
| Scope | Six extension areas: team operations, observability, routing, reliability, media, plugin ecosystem |

## 1. Introduction

### 1.1 Purpose
This SRS specifies requirements for extending 9Router beyond its current capabilities. It captures the extension areas identified from the existing codebase, documentation, and product description, and states them as verifiable requirements so that implementation and verification can proceed against a stable baseline.

### 1.2 Scope
**In scope.** Six extension areas:
1. Team operations: per-key rate limits, budgets, audit, key lifecycle.
2. Observability: provider/model health, latency, error, fallback, alerting.
3. Routing intelligence: cost/latency/quality-aware model selection with explainability and caps.
4. Reliability: end-to-end test coverage of critical request paths.
5. Media: additional providers and fallback for video, speech, and image.
6. Plugin ecosystem: a stable extension API for providers, filters, and integrations.

**Out of scope.** Renaming the product, routes, ports, or config keys; changing upstream mergeability; replacing the storage engine; any change that breaks the `/v1` OpenAI-compatible contract.

### 1.3 Product overview

#### 1.3.1 Product perspective
9Router is a local-first, OpenAI-compatible gateway that routes traffic across 40+ upstream providers. It translates formats, falls back across accounts and combos, refreshes OAuth tokens, and tracks usage in local SQLite. The extensions in this SRS operate within that boundary and reuse existing subsystems (combos, fallback, quota, usage DB, dashboard).

#### 1.3.2 Product functions
- Route `/v1/*` requests across providers with format translation and fallback.
- Track usage, quota, and cost estimates per provider/model.
- Expose a dashboard for operations.
- Compress tool results (RTK) to save tokens.
- Manage API keys with access restrictions.

#### 1.3.3 User characteristics
- Individual developers running locally (localhost:20128).
- Operators of shared instances managing providers, accounts, keys, and quota for teams.
- Both classes have terminal-first, dashboard-second workflow and expect dense, readable UI.

#### 1.3.4 Limitations
- Plain JavaScript (ESM), no TypeScript.
- Storage is local SQLite; extensions shall not require an external database.
- Fork must stay mergeable with upstream decolua/9router.
- Cost figures are estimates, not actual billing.
- Request hooks are fail-open.

### 1.4 Definitions
- **API key**: credential issued by an instance to a client; validated by `validateApiKey`.
- **Combo**: named model combination with fallback ordering.
- **Provider**: upstream service (OAuth, free, or API-key based).
- **Fallback**: automatic retry on next account/model when a request fails.
- **RTK**: request hook that compresses `tool_result` content.
- **Jev router**: cost-first model router selecting cheap models for simple tasks.
- **Executor**: provider-specific request implementation under `open-sse/executors`.
- **Handler**: format/protocol implementation under `open-sse/handlers`.

## 2. References
- `PRODUCT.md` — product description, constraints, principles.
- `README.md` — feature list, supported providers, CLI tools.
- `AGENTS.md` — upstream constraints and development rules.
- `src/lib/db/repos/apiKeysRepo.js` — current API key schema and operations.
- `src/app/api/health/route.js` — current health endpoint.
- `open-sse/executors/index.js` — executor registry.
- `open-sse/handlers/{image,video,tts}Providers` — media handler registries.
- `src/app/(dashboard)` — dashboard pages.
- `tests/unit` — existing unit test suite (427 files).
- ISO/IEC/IEEE 29148:2018 — Systems and software engineering, Life cycle processes, Requirements engineering.

## 3. Specific requirements

### 3.1 External interfaces

#### 3.1.1 User interface (dashboard)
- **EXT-UI-001** The dashboard shall display per-key usage, rate-limit status, and budget consumption on the keys management page.
- **EXT-UI-002** The dashboard shall display provider and model health status, recent error rate, and p95 latency on the usage page.
- **EXT-UI-003** The dashboard shall display the selected model and the selection rationale for Jev-routed requests in the request detail view.
- **EXT-UI-004** The dashboard shall not remove or relocate existing cards when a new card is added to a page.

#### 3.1.2 Software interfaces (API)
- **EXT-API-001** The system shall expose a metrics endpoint in Prometheus text format at `/api/metrics`.
- **EXT-API-002** The system shall expose a webhook configuration endpoint for alert delivery.
- **EXT-API-003** The system shall preserve the existing `/v1/*` OpenAI-compatible contract for all extensions.

#### 3.1.3 Communications interfaces
- **EXT-COM-001** The system shall support outbound webhook delivery over HTTPS with retry and timeout.
- **EXT-COM-002** The system shall send alert payloads as JSON.

### 3.2 Functions

#### 3.2.1 Team operations (per-key limits and audit)
- **FR-TO-001** When an API key is created, the system shall store an optional rate limit (requests per minute) and an optional budget (tokens or cost per period).
- **FR-TO-002** When a request presents an API key, the system shall enforce the key's rate limit and reject excess requests with HTTP 429 and a `Retry-After` header.
- **FR-TO-003** When a request presents an API key, the system shall enforce the key's budget and reject requests that would exceed it with HTTP 402.
- **FR-TO-004** The system shall reset per-key budgets on a configurable period (daily or monthly).
- **FR-TO-005** The system shall record an audit entry for key creation, update, deletion, and limit changes, including actor, timestamp, and changed fields.
- **FR-TO-006** The system shall allow an operator to revoke a key immediately, after which validation fails within one request.
- **FR-TO-007** The system shall not apply rate limits or budgets to requests that do not present an API key (local/no-auth mode).

#### 3.2.2 Observability
- **FR-OBS-001** The system shall record per-provider and per-model request count, error count, and latency percentiles (p50, p95, p99) in the database.
- **FR-OBS-002** The system shall record fallback events, including source model, target model, and reason.
- **FR-OBS-003** The system shall record token-refresh failures, including provider and error reason.
- **FR-OBS-004** The system shall expose a health status per provider (healthy, degraded, down) derived from recent error rate and latency.
- **FR-OBS-005** When a health status changes, the system shall emit an alert through configured channels.
- **FR-OBS-006** The system shall retain observability data for at least 30 days.

#### 3.2.3 Routing intelligence
- **FR-RT-001** The system shall record the selected model and selection rationale for each Jev-routed request in `jevLogs`.
- **FR-RT-002** The system shall support a configurable cost cap per request for Jev routing.
- **FR-RT-003** The system shall spread load across providers when selecting among equivalent-cost models.
- **FR-RT-004** The system shall expose the selection rationale in the request detail view.
- **FR-RT-005** The system shall allow operators to pin or exclude models from Jev routing.

#### 3.2.4 Reliability and test coverage
- **FR-REL-001** The system shall provide end-to-end tests for streaming chat, tool calling, format translation, retry, and fallback paths.
- **FR-REL-002** The system shall run the end-to-end test suite in CI on every pull request.
- **FR-REL-003** When a test fails, the system shall report the failing scenario and the request/response payload.

#### 3.2.5 Media extension
- **FR-MED-001** The system shall support at least one additional video provider beyond the current three.
- **FR-MED-002** The system shall support fallback between media providers on failure.
- **FR-MED-003** The system shall report media provider health using the same observability model as chat providers.

#### 3.2.6 Plugin ecosystem
- **FR-PLG-001** The system shall define a documented interface for registering a new provider executor.
- **FR-PLG-002** The system shall define a documented interface for registering a request filter (RTK-style).
- **FR-PLG-003** The system shall load plugins from a configured directory without modifying core source.
- **FR-PLG-004** The system shall validate plugin conformance at load time and disable non-conforming plugins with a logged error.

### 3.3 Usability requirements
- **NFR-US-001** The dashboard shall render per-key and per-provider tables with row click to open a detail modal showing full, untruncated content.
- **NFR-US-002** The dashboard shall display long identifiers with `break-all` and numeric columns with `tabular-nums`.
- **NFR-US-003** The dashboard shall preserve existing page layout when new cards are added (additive only).

### 3.4 Performance requirements
- **NFR-PERF-001** Rate-limit and budget enforcement shall add no more than 5 ms p95 latency to a request.
- **NFR-PERF-002** The metrics endpoint shall respond within 500 ms under normal load.
- **NFR-PERF-003** Observability writes shall not block the request response (async or batched).

### 3.5 Logical database requirements
- **NFR-DB-001** The system shall store per-key rate limits, budgets, audit entries, observability aggregates, and plugin metadata in the existing SQLite database.
- **NFR-DB-002** The system shall migrate the database schema additively without data loss.
- **NFR-DB-003** The system shall prune observability data older than the retention period automatically.

### 3.6 Design constraints
- **NFR-DC-001** Extensions shall be implemented in plain JavaScript (ESM).
- **NFR-DC-002** Extensions shall not introduce new runtime dependencies unless no existing dependency or stdlib covers the need.
- **NFR-DC-003** Extensions shall preserve upstream mergeability (no renames of product, routes, ports, config keys).

### 3.7 Software system attributes
- **NFR-SEC-001** The system shall not expose API keys, tokens, or credentials in logs, metrics, or audit entries beyond a redacted form.
- **NFR-SEC-002** The system shall validate all external inputs at trust boundaries.
- **NFR-REL-001** Request hooks (rate limit, budget, RTK) shall be fail-open: on error the request proceeds unmodified.
- **NFR-MAINT-001** Each extension shall include at least one runnable test or self-check.

## 4. Verification

| Req ID | Method | Verification criteria |
|---|---|---|
| EXT-UI-001 | Test | Keys page shows usage, rate-limit, budget columns; values match DB. |
| EXT-UI-002 | Test | Usage page shows health, error rate, p95; values match aggregates. |
| EXT-UI-003 | Test | Request detail shows selected model and rationale for Jev requests. |
| EXT-UI-004 | Inspection | No existing card removed/relocated when new card added. |
| EXT-API-001 | Test | `/api/metrics` returns Prometheus text with expected metric names. |
| EXT-API-002 | Test | Webhook config CRUD endpoints return correct status codes. |
| EXT-API-003 | Test | Existing `/v1/*` contract tests pass unchanged. |
| EXT-COM-001 | Test | Webhook delivery retries on failure and times out. |
| EXT-COM-002 | Inspection | Alert payload is valid JSON with documented fields. |
| FR-TO-001 | Test | Key creation with limits stores values; without limits stores null. |
| FR-TO-002 | Test | Excess requests return 429 with Retry-After within window. |
| FR-TO-003 | Test | Budget-exceeding request returns 402. |
| FR-TO-004 | Test | Budget resets after configured period. |
| FR-TO-005 | Test | Audit entries contain actor, timestamp, changed fields. |
| FR-TO-006 | Test | Revoked key fails validation on next request. |
| FR-TO-007 | Test | No-key requests are not rate-limited. |
| FR-OBS-001 | Test | Aggregates match recorded requests. |
| FR-OBS-002 | Test | Fallback events recorded with source/target/reason. |
| FR-OBS-003 | Test | Token-refresh failures recorded. |
| FR-OBS-004 | Analysis | Health status derived from error rate/latency thresholds. |
| FR-OBS-005 | Test | Status change triggers alert delivery. |
| FR-OBS-006 | Test | Data older than 30 days pruned. |
| FR-RT-001 | Test | `jevLogs` contains `_formula`/level for Jev requests. |
| FR-RT-002 | Test | Cost cap enforced; over-cap requests rejected or downgraded. |
| FR-RT-003 | Test | Load spread across providers under equivalent cost. |
| FR-RT-004 | Demonstration | Rationale visible in request detail. |
| FR-RT-005 | Test | Pinned/excluded models respected. |
| FR-REL-001 | Test | E2E scenarios pass. |
| FR-REL-002 | Inspection | CI runs E2E on PR. |
| FR-REL-003 | Inspection | Failure report includes scenario and payload. |
| FR-MED-001 | Test | Additional video provider reachable. |
| FR-MED-002 | Test | Media fallback on failure. |
| FR-MED-003 | Test | Media health uses same model. |
| FR-PLG-001 | Inspection | Provider registration interface documented. |
| FR-PLG-002 | Inspection | Filter registration interface documented. |
| FR-PLG-003 | Test | Plugin loads from configured dir without core edits. |
| FR-PLG-004 | Test | Non-conforming plugin disabled with logged error. |
| NFR-US-001 | Inspection | Row click opens detail modal with full content. |
| NFR-US-002 | Inspection | `break-all` and `tabular-nums` applied. |
| NFR-US-003 | Inspection | Additive layout only. |
| NFR-PERF-001 | Test | Rate-limit/budget overhead <= 5 ms p95. |
| NFR-PERF-002 | Test | Metrics endpoint <= 500 ms. |
| NFR-PERF-003 | Test | Observability writes non-blocking. |
| NFR-DB-001 | Inspection | Data stored in SQLite. |
| NFR-DB-002 | Test | Migration preserves data. |
| NFR-DB-003 | Test | Pruning removes old data. |
| NFR-DC-001 | Inspection | Plain JS (ESM). |
| NFR-DC-002 | Inspection | No new deps without justification. |
| NFR-DC-003 | Inspection | Upstream mergeability preserved. |
| NFR-SEC-001 | Test | No secrets in logs/metrics/audit. |
| NFR-SEC-002 | Test | Invalid inputs rejected. |
| NFR-REL-001 | Test | Hooks fail-open on error. |
| NFR-MAINT-001 | Inspection | Each extension has a test or self-check. |

## 5. Supporting information

### 5.1 Assumptions
- A1: The existing SQLite adapter supports additive schema migrations.
- A2: Webhook delivery can use the existing HTTP client (undici/fetch).
- A3: Plugins can be loaded with dynamic `import()` from a configured directory.
- A4: The dashboard's i18n system can accommodate new English strings via locale updates.

### 5.2 Open questions
- Q1: Should rate limits be per-key only or also per-provider/per-model?
- Q2: What retention period is acceptable for audit entries (vs observability)?
- Q3: Should plugin loading be opt-in or always-on?
- Q4: What alert channels are required beyond webhook (email, Slack, Telegram)?
- Q5: Is a per-request cost cap enforced by rejection or by model downgrade?

### 5.3 Requirement trace summary
This SRS is derived from the extension areas proposed in the prior analysis of the 9Router codebase. Each requirement maps to one of six areas: team operations (FR-TO-*), observability (FR-OBS-*), routing (FR-RT-*), reliability (FR-REL-*), media (FR-MED-*), and plugins (FR-PLG-*). Cross-cutting concerns are captured under NFR-*.

---
*End of SRS.*
