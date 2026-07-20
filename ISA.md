---
task: "Build and deploy WinYOLO Windows automation control plane"
project: WinYOLO
effort: advanced
effort_source: auto
phase: execute
progress: 0/36
mode: unattended
started: 2026-07-19T22:30:00-04:00
updated: 2026-07-20T09:20:00-04:00
---

## Problem

Frontier models can automate development tasks, but Windows-native execution is often opaque: users cannot easily see which native commands ran, why they ran, what they changed, or where a dangerous action was paused. Codex already supports native Windows, so WinYOLO must add a distinct control plane rather than claim basic Windows compatibility as novel.

## Vision

WinYOLO turns a natural-language task into a visible, auditable Windows execution. A user watches GPT-5.6 inspect the machine, propose PowerShell or cmd actions, stream their output, pause on recognized destructive system actions, and leave a replayable receipt. The same Windows-resident service powers its terminal, dashboard, MCP server, and Codex plugin.

## Out of Scope

- No WSL, Linux shell, or `\\wsl$` execution.
- No UAC elevation, driver installation, registry mutation, service management, or GUI automation in v1.
- No claim that static inspection of arbitrary PowerShell is a security sandbox.
- No remote dashboard exposure or multi-user authentication in v1.
- No concurrent autonomous runs in v1.

## Principles

- One execution authority owns policy, approval, logging, and process launch.
- Every native action produces a human-readable and machine-readable receipt.
- Raw power is acceptable only when its limits are described honestly.
- Local-first operation keeps credentials and command authority on the PC.

## Constraints

- TypeScript and Bun only; package operations use Bun.
- Bind only to `127.0.0.1` and reject untrusted browser origins.
- OpenAI Responses API with `gpt-5.6` is the primary model path.
- PowerShell and cmd execute directly on Windows without WSL.
- API keys never reach browser JavaScript, events, or persisted logs.
- Raw shell policy is advisory; recognized protected-root operations require explicit local confirmation.

## Goal

Ship a testable Windows-resident WinYOLO service that completes a GPT-5.6 tool loop through native Windows commands, streams an auditable timeline to a localhost dashboard, gates recognized destructive system actions behind typed confirmation, exposes the same authority through MCP/Codex plugin surfaces, and passes deterministic tests plus a real Windows smoke test.

## Criteria

- [ ] ISC-1: `bun install` exits 0 from a fresh checkout.
- [ ] ISC-2: `bun run typecheck` emits zero TypeScript errors.
- [ ] ISC-3: `bun test` exits 0.
- [ ] ISC-4: `GET /health` returns HTTP 200 and `status: ok`.
- [ ] ISC-5: The server listens only on the configured loopback host by default.
- [ ] ISC-6: An unexpected browser `Origin` receives HTTP 403.
- [ ] ISC-7: `POST /api/runs` creates one run and returns its identifier.
- [ ] ISC-8: A second active run receives HTTP 409.
- [ ] ISC-9: `GET /api/runs/:id` returns status, events, and pending approval.
- [ ] ISC-10: Server-sent events stream run updates to a connected dashboard.
- [ ] ISC-11: Run transitions are appended to a JSONL receipt on disk.
- [ ] ISC-12: Persisted receipts redact OpenAI-style API keys.
- [ ] ISC-13: OpenAI provider defaults to model `gpt-5.6`.
- [ ] ISC-14: OpenAI tool definitions use strict JSON schemas.
- [ ] ISC-15: Function-call outputs preserve the model-provided `call_id`.
- [ ] ISC-16: Agent runs stop at the configured maximum tool-step count.
- [ ] ISC-17: Shell output is bounded by the configured byte limit.
- [ ] ISC-18: Timed-out shell processes return a structured timeout result.
- [ ] ISC-19: PowerShell launches without `shell: true`.
- [ ] ISC-20: Windows PowerShell scripts use UTF-16LE `-EncodedCommand` transport.
- [ ] ISC-21: `wsl`, `bash`, and `\\wsl$` shell requests are rejected.
- [ ] ISC-22: Recognized destructive commands receive a high-risk label.
- [ ] ISC-23: Recognized destructive protected-root commands pause for confirmation.
- [ ] ISC-24: Unknown-target destructive commands pause for confirmation.
- [ ] ISC-25: Incorrect confirmation text cannot resume an action.
- [ ] ISC-26: Correct confirmation text resumes the exact bound action.
- [ ] ISC-27: UNC and Windows device namespaces are blocked by default.
- [ ] ISC-28: Dashboard displays task, status, risk, command, output, and approval state.
- [ ] ISC-29: CLI `doctor` reports OS, Bun, PowerShell, Codex, key, and loopback readiness.
- [ ] ISC-30: CLI `demo` exercises native inspection without an API key.
- [ ] ISC-31: Codex CLI provider produces decisions through the canonical tool authority.
- [ ] ISC-32: MCP tools call the same executor and policy engine as HTTP runs.
- [ ] ISC-33: Codex plugin manifest validates and references its real skill and MCP file.
- [ ] ISC-34: Windows install script creates a runnable local launcher without elevation.
- [ ] ISC-35: Windows smoke script verifies health, native inspection, and advisory policy fixtures.
- [ ] ISC-36: Anti: no runtime code invokes WSL or requires a Linux subsystem.

## Test Strategy

| ISC | Type | Check | Threshold | Tool |
|---|---|---|---|---|
| ISC-1–3 | build | install, types, unit suite | exit 0 | Bun |
| ISC-4–12 | API | live localhost contract and persistence | all assertions pass | Bun tests + curl |
| ISC-13–16 | provider | fixture Responses API transcript | exact tool/result sequence | Bun tests |
| ISC-17–27 | safety | executor and adversarial policy fixtures | all deterministic cases pass | Bun tests |
| ISC-28–30 | experience | dashboard asset/static assertions and CLI probes | expected content/output | Bun + browser |
| ISC-31–33 | integration | Codex fixture, MCP initialization, plugin validator | exit 0 | Bun |
| ISC-34–36 | Windows | install and smoke workflow on configured PC | exit 0 | PowerShell |

## Features

| Name | Description | Satisfies | Depends on | Parallelizable |
|---|---|---|---|---|
| CoreAuthority | Config, events, receipts, policy, executor | ISC-5–6, ISC-11–12, ISC-17–27, ISC-36 | none | false |
| ResponsesAgent | GPT-5.6 strict function-calling loop | ISC-13–16 | CoreAuthority | false |
| LocalSurfaces | HTTP API, SSE, dashboard, CLI | ISC-4, ISC-7–10, ISC-28–30 | CoreAuthority, ResponsesAgent | false |
| CodexSurfaces | Codex decision adapter, MCP, plugin | ISC-31–33 | CoreAuthority | true |
| WindowsDelivery | Installer, doctor, smoke suite, docs | ISC-1–3, ISC-34–36 | all | false |

## Decisions

- 2026-07-19 22:30: Reframed the project as an auditable Windows automation control plane because current Codex already runs natively on Windows; observability, receipts, and policy checkpoints are the differentiators.
- 2026-07-19 22:30: Raw PowerShell remains available per the requested YOLO mode. Protected-root detection is explicitly advisory because arbitrary PowerShell can evade static analysis.
- 2026-07-19 22:30: Core Responses API execution is the critical path. Codex CLI and plugin are thin alternate planning/transport surfaces over the same authority and cannot own direct execution.
