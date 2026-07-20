---
task: "Build and deploy WinYOLO Windows automation control plane"
project: WinYOLO
effort: advanced
effort_source: auto
phase: execute
progress: 34/40
mode: unattended
iteration: 2
started: 2026-07-19T22:30:00-04:00
updated: 2026-07-20T10:56:00-04:00
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

- [x] ISC-1: `bun install` exits 0 from a fresh checkout.
- [x] ISC-2: `bun run typecheck` emits zero TypeScript errors.
- [x] ISC-3: `bun test` exits 0.
- [x] ISC-4: `GET /health` returns HTTP 200 and `status: ok`.
- [x] ISC-5: The server listens only on the configured loopback host by default.
- [x] ISC-6: An unexpected browser `Origin` receives HTTP 403.
- [x] ISC-7: `POST /api/runs` creates one run and returns its identifier.
- [x] ISC-8: A second active run receives HTTP 409.
- [x] ISC-9: `GET /api/runs/:id` returns status, events, and pending approval.
- [x] ISC-10: Server-sent events stream run updates to a connected dashboard.
- [x] ISC-11: Run transitions are appended to a JSONL receipt on disk.
- [x] ISC-12: Persisted receipts redact OpenAI-style API keys.
- [x] ISC-13: OpenAI provider defaults to model `gpt-5.6`.
- [DEFERRED-VERIFY] ISC-13.1: The Windows primary provider completes an authenticated GPT-5.6 tool call.
- [x] ISC-14: OpenAI tool definitions use strict JSON schemas.
- [x] ISC-15: Function-call outputs preserve the model-provided `call_id`.
- [x] ISC-16: Agent runs stop at the configured maximum tool-step count.
- [x] ISC-17: Shell output is bounded by the configured byte limit.
- [x] ISC-18: Timed-out shell processes return a structured timeout result.
- [x] ISC-19: PowerShell launches without `shell: true`.
- [x] ISC-20: Windows PowerShell scripts use UTF-16LE `-EncodedCommand` transport.
- [x] ISC-21: `wsl`, `bash`, and `\\wsl$` shell requests are rejected.
- [x] ISC-22: Recognized destructive commands receive a high-risk label.
- [x] ISC-23: Recognized destructive protected-root commands pause for confirmation.
- [x] ISC-24: Unknown-target destructive commands pause for confirmation.
- [x] ISC-25: Incorrect confirmation text cannot resume an action.
- [x] ISC-26: Correct confirmation text resumes the exact bound action.
- [x] ISC-27: UNC and Windows device namespaces are blocked by default.
- [DEFERRED-VERIFY] ISC-28: Dashboard displays task, status, risk, command, output, and approval state.
- [x] ISC-29: CLI `doctor` reports OS, Bun, PowerShell, Codex, key, and loopback readiness.
- [x] ISC-30: CLI `demo` exercises native inspection without an API key.
- [x] ISC-31: Codex CLI provider produces decisions through the canonical tool authority.
- [DEFERRED-VERIFY] ISC-31.1: The Windows Codex provider completes an authenticated planning decision.
- [ ] ISC-32: MCP tools call the same executor, policy, approval, and receipt authority as HTTP runs.
- [ ] ISC-32.1: A high-risk MCP call creates dashboard-visible pending approval and resumes the exact bound call after confirmation.
- [ ] ISC-32.2: MCP exposes `win_confirm` for exact approval or rejection without creating another execution authority.
- [x] ISC-33: Codex plugin manifest validates and references its real skill and MCP file.
- [x] ISC-34: Windows install script creates a runnable local launcher without elevation.
- [x] ISC-35: Windows smoke script verifies health, native inspection, and advisory policy fixtures.
- [x] ISC-36: Anti: no runtime code invokes WSL or requires a Linux subsystem.

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
- 2026-07-20 10:56: refined: Independent QA refuted the assumption that shared `ToolAuthority` alone satisfied MCP integration; MCP must also share RunManager approval state and receipts. Authenticated Windows provider probes are now explicit deferred criteria rather than implied by harness smoke tests.

## Verification

- Local and server: frozen Bun install, TypeScript check, 30 deterministic tests, and plugin validator all exit 0.
- Live localhost: health 200, hostile Origin 403, dashboard assets, run creation/failure events, MCP initialization, and canonical MCP tool listing verified.
- Codex: a real `codex exec` structured decision returned the requested final answer after strict-schema correction.
- Plugin: Codex 0.144.5 accepted the local marketplace and installed `winyolo@winyolo-local` on the server.
- Windows relay: PID and log are active on the server, polling the configured PC every 30 seconds for up to 12 hours.
- 2026-07-20 initial state: native-PC evidence was pending while the configured Windows host was powered down; the unattended relay later completed after the host came online.
- ISC-17: native Windows smoke — a 4096-character PowerShell result was capped at 256 bytes and returned `truncated: true`.
- ISC-18: native Windows smoke — `Start-Sleep -Seconds 5` with `timeout_ms: 250` returned `timedOut: true`.
- ISC-28: deferred live-browser probe — FOLLOWUP-WINYOLO-UI-1 requires an Interceptor screenshot; host-local HTTP verified task, approval, timeline, EventSource, risk, and output surfaces.
- ISC-29: native CLI probe — `winyolo.cmd doctor` reported win32 10.0.19045, Bun 1.3.14, PowerShell, Codex 0.144.6 path, missing API key, loopback, and data directory.
- ISC-30: native CLI probe — `winyolo.cmd demo` returned `ok: true` CIM data for DESKTOP-U1J1HF8 and a high-risk protected-root confirmation fixture.
- ISC-34: native install/launcher probe — `scripts\\install.ps1` exited 0 and the resulting `winyolo.cmd doctor` and `winyolo.cmd demo` both ran successfully from a fresh SSH shell.
- ISC-35: native Windows smoke — 30 tests passed and the script printed `WINYOLO_WINDOWS_SMOKE_OK` twice, once through the relay and once from a fresh SSH session.
- ISC-13.1: deferred authenticated-provider probe — FOLLOWUP-WINYOLO-AUTH-1 requires an OpenAI API key on the Windows host; current failure is explicit: `OPENAI_API_KEY is required for provider 'openai'.`
- ISC-31.1: deferred authenticated-provider probe — FOLLOWUP-WINYOLO-AUTH-2 requires `codex login` on the Windows host; Codex CLI 0.144.6 currently reports `Not logged in`.
