---
task: "Build and deploy WinYOLO Windows automation control plane"
project: WinYOLO
effort: advanced
effort_source: auto
phase: verify
progress: 173/195
mode: interactive
iteration: 7
started: 2026-07-19T22:30:00-04:00
updated: 2026-07-21T16:50:00-04:00
---

## Problem

Frontier models can automate development tasks, but Windows-native execution is often opaque: users cannot easily see which native commands ran, why they ran, what they changed, or where a dangerous action was paused. Codex already supports native Windows, so WinYOLO must add a distinct control plane rather than claim basic Windows compatibility as novel.

The first implementation made WinYOLO's custom agent and execution receipt the primary experience. That duplicates an inferior subset of the official Codex TUI and fragments conversation history. The primary experience must instead be the real Windows-native Codex CLI, while the website becomes a private companion over Codex's official app-server protocol.

## Vision

Running `winyolo` opens the official Codex TUI in-place with its complete native behavior and a YOLO default that is impossible to miss. The companion site feels like a focused ChatGPT client for that same session history: searchable conversations, readable transcripts, native thread lifecycle actions, streaming browser turns, image input, safe approvals, interruption, and a clearly secondary Audit view for WinYOLO receipts. Codex remains the transcript authority; WinYOLO remains a thin launcher, private gateway, and audit companion.

## Out of Scope

- No WSL, Linux shell, or `\\wsl$` execution.
- No Hyper-V, Windows Sandbox, driver installation, remote dashboard exposure, or GUI automation in 0.3.
- No claim that static inspection of arbitrary PowerShell is a security sandbox.
- No remote dashboard exposure or multi-user authentication in v1.
- No concurrent autonomous runs in v1.
- No custom terminal UI or fork of the Codex TUI.
- No private JSONL transcript parser or duplicate transcript database.
- No browser exposure of Codex authentication or raw app-server stdio.

## Principles

- One execution authority owns policy, approval, logging, and process launch.
- Every native action produces a human-readable and machine-readable receipt.
- Raw power is acceptable only when its limits are described honestly.
- Local-first operation keeps credentials and command authority on the PC.
- Codex owns conversation semantics; WinYOLO adapts official interfaces instead of cloning them.
- Safety mode is explicit, inspectable, and never inferred from a cosmetic browser state.

## Constraints

- TypeScript and Bun only; package operations use Bun.
- Bind only to `127.0.0.1` and reject untrusted browser origins.
- OpenAI Responses API with `gpt-5.6` is the primary model path.
- PowerShell and cmd execute directly on Windows without WSL.
- API keys never reach browser JavaScript, events, or persisted logs.
- Raw shell remains inside Codex's active native sandbox; structured operations additionally receive exact target policy.
- Bare `winyolo` defaults to workspace-write/on-request with command networking denied.
- `winyolo yolo` uses workspace-write/never and cannot escalate to danger-full-access.
- `winyolo safe` defaults to `--sandbox workspace-write --ask-for-approval on-request`.
- App-server transport remains private to the Bun backend and is restart-bounded.

## Goal

Ship WinYOLO as a Windows-native Codex launcher and loopback companion: the CLI must preserve the official Codex TUI and argument surface with deliberate YOLO/Safe defaults; the backend must expose official Codex threads through an isolated, resilient app-server adapter; the website must provide shared history, transcript, archive, browser-turn, approval, image, streaming, refresh-recovery, interrupt, and secondary Audit experiences without duplicating Codex's transcript store.

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
- [x] ISC-32: MCP tools call the same executor, policy, approval, and receipt authority as HTTP runs.
- [x] ISC-32.1: A high-risk MCP call creates dashboard-visible pending approval and resumes the exact bound call after confirmation.
- [x] ISC-32.2: MCP exposes `win_confirm` for exact approval or rejection without creating another execution authority.
- [x] ISC-33: Codex plugin manifest validates and references its real skill and MCP file.
- [x] ISC-34: Windows install script creates a runnable local launcher without elevation.
- [x] ISC-35: Windows smoke script verifies health, native inspection, and advisory policy fixtures.
- [x] ISC-36: Anti: no runtime code invokes WSL or requires a Linux subsystem.

### Terminal-first redesign

- [DEFERRED-VERIFY] ISC-37: Bare `winyolo` resolves and launches the native Codex executable with inherited stdin, stdout, and stderr.
- [x] ISC-38: Bare `winyolo` injects workspace-write, on-request, and network-denied defaults.
- [x] ISC-39: `winyolo safe` injects `--sandbox workspace-write --ask-for-approval on-request` when no explicit safety override is present.
- [x] ISC-40: Explicit Codex approval flags suppress WinYOLO's default approval arguments.
- [x] ISC-41: Explicit Codex sandbox flags suppress WinYOLO's default sandbox arguments.
- [x] ISC-42: Codex subcommands including `resume`, `fork`, and `archive` pass through unchanged.
- [x] ISC-43: Codex flags including `--image`, `--model`, `--search`, `--profile`, `--cd`, and `--config` pass through unchanged.
- [x] ISC-44: The launcher propagates the Codex child process exit code.
- [x] ISC-45: The launcher attempts to start the loopback companion only when `/health` is unavailable.
- [x] ISC-46: Explicit `serve`, `doctor`, `demo`, and `run` commands retain WinYOLO behavior.
- [x] ISC-47: `doctor` reports Codex version and plugin installation diagnostics.
- [DEFERRED-VERIFY] ISC-48: The PowerShell installer verifies a usable Codex executable.
- [DEFERRED-VERIFY] ISC-49: The PowerShell installer installs or updates the WinYOLO plugin idempotently.
- [DEFERRED-VERIFY] ISC-50: The PowerShell installer leaves a `winyolo.cmd` launcher on the user's PATH without elevation.

### Codex session gateway

- [x] ISC-51: The Codex gateway initializes one `codex app-server --listen stdio://` child using newline-delimited JSON-RPC.
- [x] ISC-52: Concurrent gateway requests resolve only their correlated response identifiers.
- [x] ISC-53: Gateway notifications are delivered to subscribers without satisfying pending requests.
- [x] ISC-54: Malformed app-server messages are ignored or surfaced diagnostically without crashing the Bun server.
- [x] ISC-55: Gateway shutdown rejects pending requests and terminates its child gracefully.
- [x] ISC-56: Unexpected child exits trigger no more than the configured restart limit.
- [x] ISC-57: Gateway diagnostics include Codex version and transport health without secrets.
- [x] ISC-58: Thread listing uses `thread/list` and maps pagination cursors.
- [x] ISC-59: Thread search filters native summaries without reading private session files.
- [x] ISC-60: Transcript loading uses `thread/read` and preserves supported item types.
- [x] ISC-61: Archive and unarchive operations use `thread/archive` and `thread/unarchive`.
- [x] ISC-62: Browser thread creation and resumption use `thread/start` and `thread/resume`.
- [x] ISC-63: Browser turns and interruption use `turn/start` and `turn/interrupt`.
- [x] ISC-64: App-server errors and unavailability map to bounded, redacted HTTP errors.

### Companion website and API

- [x] ISC-65: `GET /api/codex/threads` validates limit, cursor, search, and archived query parameters.
- [x] ISC-66: `GET /api/codex/threads/:id` returns a native transcript or HTTP 404 for an unknown thread.
- [x] ISC-67: Archive and unarchive REST endpoints validate thread identifiers and return the updated state.
- [x] ISC-68: Browser thread creation accepts cwd plus Safe/YOLO policy and defaults to Safe.
- [x] ISC-69: Browser turn creation accepts non-empty text and optional local image paths.
- [x] ISC-70: Safe browser turns surface Codex approval requests and never auto-approve them.
- [x] ISC-71: YOLO browser turns use `approvalPolicy: never`, workspace-write, and network denied.
- [x] ISC-72: Active browser turns can be interrupted through a dedicated REST endpoint.
- [x] ISC-73: SSE publishes assistant deltas, plans, commands, tool output, patches, approvals, and completion notifications.
- [x] ISC-74: SSE reconnect accepts a last-event cursor and replays buffered events without duplicating event identifiers.
- [DEFERRED-VERIFY] ISC-75: The homepage renders a searchable conversation sidebar and selected transcript.
- [DEFERRED-VERIFY] ISC-76: Transcript metadata displays timestamps, working directory, source, status, and archive state.
- [DEFERRED-VERIFY] ISC-77: “Resume in terminal” copies `winyolo resume <thread-id>`.
- [DEFERRED-VERIFY] ISC-78: The composer supports text, local-image paths, Safe/YOLO selection, send, and stop.
- [DEFERRED-VERIFY] ISC-79: Persistent indicators distinguish Safe, constrained YOLO, and Isolated modes.
- [DEFERRED-VERIFY] ISC-80: Existing execution receipts remain reachable in a secondary Audit view.
- [DEFERRED-VERIFY] ISC-81: Browser refresh restores selected thread and reconnects active-turn events.
- [x] ISC-82: API routes and Codex transport never return authentication secrets or raw environment values.
- [x] ISC-83: Anti: no runtime source reads Codex private JSONL session files.
- [x] ISC-84: Anti: no runtime invocation references WSL, Bash, or `\\wsl$`.

### Competitive audit and demo package

- [x] ISC-85: The competitive feature audit assigns one status to each supplied recommendation.
- [x] ISC-86: Every implemented audit claim cites a repository evidence path.
- [x] ISC-87: The audit distinguishes advisory policy from enforceable isolation.
- [x] ISC-88: The audit cites the disposable restricted-account execution implementation.
- [x] ISC-89: The audit cites Git checkpoint, patch export, accept, and rollback implementation.
- [x] ISC-90: The audit cites network denial, secret withholding, hook policy, and protected ACLs.
- [x] ISC-91: The audit cites nine structured Windows developer/system tools.
- [x] ISC-92: The audit cites the explicit confirmation-gated comparison benchmark.
- [x] ISC-93: The demo script fits within a three-minute timeline.
- [x] ISC-94: The demo uses only existing, reproducible WinYOLO commands.
- [x] ISC-95: The demo avoids executing a destructive protected-root action.
- [x] ISC-96: The story positions WinYOLO as a native Codex launcher and transparent companion.
- [x] ISC-97: The story demonstrates implemented isolation and rollback without full-access claims.
- [x] ISC-98: A root-level Windows text guide contains all operator actions.
- [x] ISC-98.1: The Windows PC copy of the text guide matches the local SHA-256 hash.
- [x] ISC-99: The Windows text guide includes failure-safe fallback steps.
- [x] ISC-100: Anti: the package never claims unverified Windows or Chrome acceptance.

### Windows launcher incident repair

- [x] ISC-101: The native PC probe reproduces bare `winyolo` as unresolved before repair.
- [x] ISC-102: A hashed timestamped PC backup archive exists before source deployment.
- [x] ISC-103: The backup archive contains the pre-deploy 0.1.0 package manifest.
- [x] ISC-104: The deployed PC package manifest reports version 0.2.0.
- [x] ISC-105: The deployment preserves the PC's existing `.env` bytes.
- [x] ISC-106: Running `scripts\install.ps1` twice succeeds on the PC.
- [x] ISC-107: The registered user PATH contains the WinYOLO project root exactly once.
- [x] ISC-108: A refreshed PowerShell process resolves bare `winyolo` to `winyolo.cmd`.
- [x] ISC-109: Bare `winyolo doctor` exits successfully on the PC.
- [x] ISC-110: Bare `winyolo --version` reaches the native Codex executable.
- [x] ISC-111: Bare `winyolo safe --help` reaches native Codex Safe mode.
- [x] ISC-112: The native Windows smoke suite prints its success marker.
- [x] ISC-113: The current project check passes all 49 tests on Windows.
- [x] ISC-114: The operator guide includes current-session PATH refresh recovery.
- [x] ISC-115: The operator guide includes an explicit `.\winyolo.cmd doctor` fallback.
- [x] ISC-116: Anti: narration identifies the configured DA as NAR, never PAI.

### Windows-native 0.3 completion

- [x] ISC-117: Bare WinYOLO builds workspace-write/on-request/network-denied Codex arguments.
- [x] ISC-118: `winyolo yolo` builds workspace-write/never/network-denied Codex arguments.
- [x] ISC-119: Anti: all full-access launcher flags and config forms throw before spawn.
- [x] ISC-120: Browser Safe is the default mode.
- [x] ISC-121: Browser YOLO uses workspace-write/never with network denied.
- [x] ISC-122: Checkpoint preparation refuses a non-Git directory with an exact remediation.
- [x] ISC-123: Checkpoint acceptance preserves original dirty tracked and untracked files.
- [x] ISC-124: Rollback exports a patch before worktree removal.
- [x] ISC-125: The native broker calls `CreateProcessWithLogonW` and assigns a kill-on-close Job Object.
- [DEFERRED-VERIFY] ISC-126: Target Windows attack probe proves isolated child processes cannot survive interrupt.
- [x] ISC-127: Isolated environments omit user/cloud/API credential variables and use a runner profile.
- [x] ISC-128: Project `.env` files are withheld from isolated baselines.
- [x] ISC-129: Bundled PreToolUse blocks secret paths, device namespaces, compatibility transports, and full-access escalation.
- [x] ISC-130: Schema-2 receipts contain nullable session/thread/turn/tool/checkpoint/process/diff fields.
- [x] ISC-131: Schema-1 JSONL loads with new fields normalized to null.
- [x] ISC-132: Nine structured Windows tools expose strict closed schemas.
- [x] ISC-133: Service policy blocks protected-service mutations.
- [x] ISC-134: Registry writes outside `HKCU\Software\WinYOLO` are blocked.
- [x] ISC-135: Event Log queries cap time range and result count.
- [x] ISC-136: WinGet mutations require an exact package identifier and confirmation.
- [x] ISC-137: All isolation, checkpoint, and capability endpoints inherit loopback Origin protection.
- [x] ISC-138: Companion Isolated mode streams output and exposes Accept/Rollback controls.
- [x] ISC-139: `scripts/install.ps1 -Full` provisions toolchain, runner, DPAPI secret, ACLs, plugin, and hooks.
- [x] ISC-140: The explicit comparison benchmark requires `BENCHMARK-ONLY` and is dynamically quarantined.
- [x] ISC-141: Production source scan reports zero forbidden compatibility transports.
- [x] ISC-142: BrokenBuild deterministically starts with a failing addition test and includes reset/verify commands.
- [DEFERRED-VERIFY] ISC-143: Full installer and adversarial smoke pass twice on Windows 10 Home build 19045.
- [DEFERRED-VERIFY] ISC-144: Interceptor real-Chrome acceptance passes history, streaming, approvals, interrupt, Audit, isolation, refresh, Accept, and Rollback.
- [x] ISC-145: Root operator guide contains exact install, UAC, login, hook, isolation, Chrome, benchmark, demo, rollback, and recovery sequences.

### Submission-day stale-server recovery

- [x] ISC-146: Failed checkpoint `cp-a43b1cfd-0f8f-4835-8a41-d233410dfca7` is rolled back before another isolated run starts.
- [x] ISC-147: The process listening on port 4747 starts after the fixed `src/isolation.ts` deployment timestamp.
- [x] ISC-148: A fresh isolated run reaches `completed`.
- [x] ISC-148.1: The fresh run receipt command begins `codex.exe --ask-for-approval never exec`.
- [x] ISC-149: The checkpoint selected for inspection has the same `runId` as the fresh isolated run.
- [x] ISC-150: The selected checkpoint diff creates only `isolated-proof.txt` containing exactly `OK`.
- [x] ISC-151: The accepted checkpoint leaves `isolated-proof.txt` containing exactly `OK` in the main workspace.
- [x] ISC-152: `bun run check` exits 0 with 63 tests and zero failures.
- [x] ISC-153: Native Windows smoke prints `SOURCE_SCAN_OK`.
- [x] ISC-154: Native Windows smoke prints `WINYOLO_WINDOWS_SMOKE_OK`.
- [x] ISC-155: `winyolo doctor` reports the native broker ready.
- [x] ISC-155.1: `winyolo doctor` reports the restricted runner ready.
- [x] ISC-155.2: `winyolo doctor` reports Git ready.
- [x] ISC-155.3: `winyolo doctor` reports .NET ready.
- [x] ISC-155.4: `winyolo doctor` reports MSBuild ready.
- [x] ISC-155.5: `winyolo doctor` reports WinGet ready.
- [x] ISC-155.6: `winyolo doctor` reports the Windows SDK ready.
- [x] ISC-156: Both implementation-guide copies contain the stale-server diagnosis and successful replacement-run evidence.
- [x] ISC-156.1: Both implementation-guide copies contain the observed replacement-run command, failure, rollback, and claim boundary.
- [x] ISC-157: The BrokenBuild demo reset restores the deliberate defect.
- [x] ISC-157.1: The BrokenBuild baseline test fails before repair.
- [x] ISC-157.2: The deliberately wrong isolated repair is rolled back.
- [x] ISC-157.3: The correct isolated repair diff is accepted.
- [x] ISC-157.4: The repaired demo prints `BROKEN_BUILD_TESTS_PASS`.
- [ ] ISC-157.5: The Audit view shows a schema-2 receipt.
- [ ] ISC-157.6: The Audit view shows the accepted diff hash.
- [x] ISC-158: Anti: no failed, mismatched-run, or incorrect-diff checkpoint is accepted.
- [x] ISC-158.1: Anti: no unpassed release claim is added to submission materials.

### Restricted-runner authentication completion

- [x] ISC-159: Installer exposes an explicit `-ProvisionRunnerAuth` switch.
- [x] ISC-160: Provisioning refuses when the installing user has no file-backed Codex authentication.
- [x] ISC-161: Provisioning creates the runner `CODEX_HOME` before copying authentication.
- [x] ISC-162: Runner authentication file ACL grants access only to installer user, runner, SYSTEM, and Administrators.
- [x] ISC-163: Isolated environment sets `CODEX_HOME` to the runner profile `.codex` directory.
- [x] ISC-164: Anti: hook policy continues to block tool access to any `auth.json` path.
- [x] ISC-165: Anti: no authentication contents appear in installer, test, receipt, or terminal output.
- [x] ISC-166: Local typecheck and all deterministic tests pass after the authentication change.
- [x] ISC-167: Scoped Windows deployment preserves the project `.env` and does not reinstall the toolchain.
- [ ] ISC-168: Scoped runner-auth provisioning exits 0 and `codex login status` succeeds as the restricted runner.
- [x] ISC-169: Replacement server starts after the authentication code deployment timestamp.
- [x] ISC-170: Fresh isolated proof reaches `completed` with exit status 0.
- [x] ISC-171: Fresh proof checkpoint diff creates only `isolated-proof.txt` containing exactly `OK`.
- [x] ISC-172: Accept applies the proof and `Get-Content isolated-proof.txt` returns exactly `OK`.
- [x] ISC-173: Wrong BrokenBuild repair is rolled back without changing source.
- [x] ISC-174: Correct BrokenBuild repair is accepted and prints `BROKEN_BUILD_TESTS_PASS`.
- [x] ISC-175: Final schema-2 Audit evidence contains the accepted checkpoint ID and diff hash.

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
| ISC-37–50 | launcher | exact argv, service bootstrap, installer, exit propagation | all fixtures pass | Bun tests + PowerShell smoke |
| ISC-51–64 | gateway | fake child protocol, correlation, lifecycle, redaction | all fixtures pass | Bun tests |
| ISC-65–74 | API/stream | route validation, native methods, SSE replay | all assertions pass | Bun tests + curl |
| ISC-75–81 | experience | history, transcript, composer, warning, Audit, recovery | rendered controls and behavior | Interceptor |
| ISC-82–84 | security | response scans and runtime source scans | zero leaks or forbidden transports | Bun tests + rg |
| ISC-85–92 | audit | compare supplied recommendations with repository evidence | every recommendation has one supported status | Read + rg |
| ISC-93–97 | narrative | inspect timed script and positioning language | under three minutes and no unsupported claims | Read + word/timing review |
| ISC-98–100 | operator guide | read root text file and scan commands/claims | complete steps, fallback, zero unverified acceptance claims | Read + rg |
| ISC-101–113 | Windows repair | backup, deploy, install twice, resolve launcher, run smoke | all commands exit 0 and markers match | PowerShell + SSH relay |
| ISC-114–116 | recovery/identity | inspect guide and DA identity | fallback is executable and narration says NAR | Read + rg |
| ISC-117–121 | launcher/browser policy | exact argument and app-server shapes | no full access; Safe default | Bun tests |
| ISC-122–129 | isolation/security | real Git fixture plus hook policy | source state preserved; secret/boundary probes blocked | Bun tests + Windows smoke |
| ISC-130–137 | receipt/tools/API | schema compatibility, strict definitions, Origin checks | deterministic assertions pass | Bun tests |
| ISC-138–145 | delivery | asset inspection, source scan, native smoke, Chrome | local checks pass; target probes recorded | Bun + PowerShell + Interceptor |
| ISC-146–151 | recovery | rollback, restart, run/receipt/checkpoint/diff/content correlation | exact IDs and bytes match | PowerShell + WinYOLO receipt |
| ISC-152–155 | release | check, smoke, doctor capability readiness | all named gates pass | Bun + PowerShell + WinYOLO doctor |
| ISC-156–158 | submission | guide evidence, demo rehearsal, claim safety | both copies match; complete demo; no unsupported claim | PowerShell + file hash + recorded output |
| ISC-159–166 | runner auth | explicit provisioning, ACL, environment, hook, deterministic tests | no broad access; no secret output; tests pass | PowerShell + Bun tests + source inspection |
| ISC-167–172 | proof | scoped deploy, provision, restart, completed run, exact diff, accept | all exact statuses and bytes match | PowerShell + WinYOLO receipts |
| ISC-173–175 | demo audit | wrong rollback, correct accept, passing test, schema-2 evidence | all demo transitions verified | PowerShell + WinYOLO checkpoints |

## Features

| Name | Description | Satisfies | Depends on | Parallelizable |
|---|---|---|---|---|
| CoreAuthority | Config, events, receipts, policy, executor | ISC-5–6, ISC-11–12, ISC-17–27, ISC-36 | none | false |
| ResponsesAgent | GPT-5.6 strict function-calling loop | ISC-13–16 | CoreAuthority | false |
| LocalSurfaces | HTTP API, SSE, dashboard, CLI | ISC-4, ISC-7–10, ISC-28–30 | CoreAuthority, ResponsesAgent | false |
| CodexSurfaces | Codex decision adapter, MCP, plugin | ISC-31–33 | CoreAuthority | true |
| WindowsDelivery | Installer, doctor, smoke suite, docs | ISC-1–3, ISC-34–36 | all | false |
| NativeCodexLauncher | Official TUI launch, safety defaults, pass-through, service bootstrap | ISC-37–50 | none | false |
| CodexAppServerGateway | Private JSON-RPC child lifecycle and native thread/turn operations | ISC-51–64, ISC-82–84 | NativeCodexLauncher | false |
| ConversationAPI | Validated thread lifecycle, browser turns, approvals, SSE replay | ISC-65–74 | CodexAppServerGateway | false |
| ConversationDashboard | Chat history, transcripts, composer, modes, resume, Audit | ISC-75–81 | ConversationAPI | false |
| CompetitiveAudit | Evidence-backed recommendation status matrix | ISC-85–92, ISC-100 | all implemented surfaces | false |
| ReviewerDemoPackage | Timed demo, product story, and Windows operator guide | ISC-93–99 | CompetitiveAudit | false |
| WindowsLauncherRepair | Recoverable 0.2.0 deployment, PATH repair, and native verification | ISC-101–115 | NativeCodexLauncher, WindowsDelivery | false |
| NarrationIdentity | Resolve response narration from configured DA identity | ISC-116 | none | false |
| NativeIsolation | Restricted account, Job Object, worktree checkpoints, patch recovery | ISC-122–129 | NativeCodexLauncher | false |
| WindowsStructuredTools | Path, developer stack, services, registry, Event Log, ACL tools | ISC-132–136 | CoreAuthority | true |
| ReceiptHooksV2 | Trusted lifecycle hooks and compatible schema-2 receipts | ISC-129–131 | CoreAuthority | true |
| FullWindowsDelivery | Full installer, demo, benchmark quarantine, operator guide | ISC-139–145 | NativeIsolation, WindowsStructuredTools | false |
| SubmissionDayRecovery | Replace stale server, prove isolation, gate release, and rehearse demo | ISC-146–158 | FullWindowsDelivery | false |
| RunnerAuthentication | Seed supported runner-scoped Codex auth and complete live proof/demo | ISC-159–175 | NativeIsolation, SubmissionDayRecovery | false |

## Decisions

- 2026-07-19 22:30: Reframed the project as an auditable Windows automation control plane because current Codex already runs natively on Windows; observability, receipts, and policy checkpoints are the differentiators.
- 2026-07-19 22:30: Raw PowerShell remains available per the requested YOLO mode. Protected-root detection is explicitly advisory because arbitrary PowerShell can evade static analysis.
- 2026-07-19 22:30: Core Responses API execution is the critical path. Codex CLI and plugin are thin alternate planning/transport surfaces over the same authority and cannot own direct execution.
- 2026-07-20 10:56: refined: Independent QA refuted the assumption that shared `ToolAuthority` alone satisfied MCP integration; MCP must also share RunManager approval state and receipts. Authenticated Windows provider probes are now explicit deferred criteria rather than implied by harness smoke tests.
- 2026-07-20 12:00: refined: WinYOLO's primary interface is now the official Codex TUI, not its custom agent. Codex's app-server and session store own conversations; the original run manager remains only as the Audit surface.
- 2026-07-20 12:00: Delegation floor exception: Forge will audit the implementation because coding at E3+ mandates it; a second write-agent would overlap the gateway/API/UI dependency chain and increase merge risk.
- 2026-07-20 12:26: Root-cause checkpoint: the duplicate-primary experience enters at CLI command dispatch and the homepage root. Fixing those ingestion points removes three downstream inconsistencies (terminal behavior, session authority, and dashboard hierarchy). The implementation traces display-down for the homepage and authority-outward for protocol writes.
- 2026-07-20 12:26: refined: Browser recovery uses authoritative `thread/read` snapshots plus a bounded in-memory SSE replay ring. Persisting a WinYOLO conversation log was rejected because it would create a second transcript authority.
- 2026-07-20 12:26: Safe-mode approvals are bidirectional app-server requests, not ordinary notifications. The gateway retains correlated server request IDs and only updates committed UI state after Codex accepts the response.
- 2026-07-20 13:14: ❌ DEAD END: Tried interrupting immediately after `turn/start` — app-server returned `no active turn to interrupt` because active registration is asynchronous. The verified flow waits until `thread/read` reports `inProgress`; the browser naturally has this delay, and HTTP maps the race to `turn_not_active` rather than a transport outage.
- 2026-07-20 15:05: refined: The competition narrative must describe WinYOLO as the native Codex launcher and transparent companion. Recognized destructive-action policy applies to WinYOLO's optional execution authority, not every command the unrestricted official Codex TUI can issue.
- 2026-07-20 15:05: Delegation floor exception: the approved work is documentation-only, all claims share one evidence matrix, and current collaboration rules prohibit unrequested subagents.
- 2026-07-20 13:46: The Windows PC documentation package was copied through the established relay and verified by hash; the project source itself was not overwritten because Git is unavailable in the PC SSH environment and its local-change state could not be proven clean.
- 2026-07-20 13:46: refined: The operator guide now gates recording on `package.json` version 0.2.0 because the live PC currently reports 0.1.0.
- 2026-07-20 14:02: Root cause: the live PC's registered user PATH lacks the project root because documentation was upgraded to 0.2.0 while runtime stayed at 0.1.0; reopening PowerShell cannot repair a registry value the old installer never wrote.
- 2026-07-20 14:02: The configured DA is NAR. The previous `🗣️ PAI` label came from stale response context and must not be treated as identity configuration.
- 2026-07-20 14:22: ❌ DEAD END: Tried atomically renaming the 0.1.0 project directory — Windows refused because the user's open PowerShell held that directory as its working directory; no files moved.
- 2026-07-20 14:22: Fallback deployment uses a hashed full-source archive before a scoped mirror that excludes `.env`, `.git`, and `node_modules`, preserving secrets, repository history, and dependencies in place.
- 2026-07-20 14:52: The Bun-bin launcher is the stable PATH entry and delegates to the project launcher; the project-root PATH entry is retained as an explicit direct fallback. `winyolo --version` intentionally passes through to native Codex because bare WinYOLO is the official Codex interface.
- 2026-07-20 14:52: Final advisor initially received a stale auto-attached Discord ISA; the conflict was surfaced and the advisor cleared the repair after receiving the correct `winyolo-terminal-first` ISA path and bound Windows evidence.
- 2026-07-20 20:15: refined: Safe is now the default at both launcher and browser ingestion; YOLO means approval-free inside workspace-write, never unrestricted access.
- 2026-07-20 20:15: Root-cause checkpoint: unsafe behavior entered through argument construction and app-server policy shape. Fixing both removes terminal/browser divergence and makes the OS sandbox the shared boundary.
- 2026-07-20 20:15: Delegation exception: system collaboration policy prohibited unrequested subagents, so Forge/Cato were not spawned; the implementation remained single-writer and used deterministic tests as the independent gate.
- 2026-07-20 14:52: The E4 Cato cross-vendor audit was not spawned because the active developer instruction prohibits unrequested subagents; the already-completed Forge audit and final advisor review remain the independent review evidence.
- 2026-07-21 15:36: Root-cause validation: the rejected Codex argument order came from a server started before the corrected source was deployed. The actionable remediation is rollback plus process restart; reinstalling or changing source again would not address the loaded stale module.
- 2026-07-21 15:36: Delegation floor exception: checkpoint identity, service lifetime, and acceptance are one sequential Windows state machine; parallel operators would increase the risk of correlating or accepting the wrong run.
- 2026-07-21 15:47: refined: successful isolated execution remains unverified. The restricted runner's exact missing dependency is a bearer credential available inside its sanitized profile; the installing user's authenticated Codex profile is deliberately not inherited.
- 2026-07-21 15:49: Final advisor cleared the evidence handling but blocked any release-ready claim while isolated auth, Interceptor Chrome, required video, and dirty-tree provenance remain unresolved.
- 2026-07-21 16:08: refined: Official Codex guidance supports securely seeding `auth.json` when interactive runner login is unavailable. The chosen design uses an explicit provisioning switch, runner-local `CODEX_HOME`, narrow ACLs, and existing hook protection; job-wide API-key injection was rejected because no API key exists and repository-controlled code could read it.

## Changelog

- 2026-07-20 | conjectured: Passing native tool smoke tests and sharing `ToolAuthority` meant HTTP, MCP, dashboard, and plugin behavior could not diverge.
  refuted by: Independent QA showed MCP bypassed `RunManager`, exposed no dashboard pending approval, and lacked the promised `win_confirm` path.
  learned: A single execution authority includes policy, immutable call binding, pending approval state, confirmation consumption, execution, and receipts—not merely a shared executor instance.
  criterion now: Refined ISC-32 and added ISC-32.1/ISC-32.2 for the complete MCP confirmation loop; added ISC-13.1/ISC-31.1 so authenticated Windows model execution cannot be implied by harness-only smoke tests.

- 2026-07-20 | conjectured: WinYOLO needed its custom agent and run receipt to remain the primary terminal and browser conversation experience.
  refuted by: The official native Codex TUI and app-server already own richer terminal behavior, session history, approvals, item streaming, and lifecycle operations than a custom clone can sustainably reproduce.
  learned: WinYOLO creates more value as a thin policy launcher and private browser projection; Codex must remain the single conversation authority while WinYOLO receipts stay a separate Audit concern.
  criterion now: ISC-37–84 replace the primary-interface assumption with official TUI launch, official thread/turn methods, bounded transient replay, conversation-first UI, and anti-criteria forbidding private transcript parsing or Linux transports.

- 2026-07-20 | conjectured: The competition story should describe WinYOLO as a safe Windows YOLO control plane with deep native tooling.
  refuted by: Source inspection showed advisory policy covers optional WinYOLO tool calls while direct Codex YOLO remains unrestricted; isolation, rollback, specialized Windows-stack workflows, and WSL benchmarks are absent or partial.
  learned: A narrower launcher-and-transparent-companion story is more credible, demonstrable, and technically differentiated because it preserves official Codex ownership while making permission and receipt boundaries explicit.
  criterion now: ISC-85–100 require an evidence-backed status matrix, under-three-minute reproducible demo, explicit roadmap boundary, complete Windows operator guide, and no unverified acceptance claims.

- 2026-07-20 | conjectured: Reopening PowerShell after the documented install would be sufficient to make bare `winyolo` available.
  refuted by: The PC still ran 0.1.0, its registered PATH omitted the project, the old installer never created a durable shim, and one fast MCP confirmation exposed a waiter-registration race during repeated native installs.
  learned: Windows delivery needs a launcher in an already-active PATH directory, fatal native-process exit checks, packaging hygiene, backup-first deployment, and native verification from a fresh shell outside the repository.
  criterion now: ISC-101–116 bind the repair to the reproduced failure, hashed rollback artifact, preserved `.env`, idempotent installs, fresh-shell resolution, full smoke marker, recovery instructions, and NAR narration identity.

- 2026-07-20 | conjectured: Approval-free Windows automation required removing Codex's sandbox to remain useful
  refuted by: The 0.3 launcher and app-server tests preserve workspace-write and network denial while independently selecting `approvalPolicy: never`
  learned: Approval policy and resource authority are orthogonal; useful autonomy removes prompts, not filesystem, network, identity, or recovery boundaries
  criterion now: ISC-117–121 replace unrestricted defaults, and ISC-122–145 bind isolation, structured tools, receipts, delivery, and native acceptance

- 2026-07-21 | conjectured: Restarting the server after the Codex argument-order fix would be sufficient for a successful isolated proof
  refuted by: the corrected replacement receipt reached Codex but returned HTTP 401 because the sanitized restricted-runner profile contained no bearer credential
  learned: isolated execution needs an intentional runner-scoped authentication design in addition to correct process arguments; inheriting the installing user's credential would violate the secret boundary
  criterion now: ISC-148 remains unpassed, ISC-156 remains unpassed, and submission materials explicitly block isolated/demo claims until a fresh authenticated restricted run completes

## Verification

- Local and server: frozen Bun install, TypeScript check, 34 deterministic tests, and plugin validator all exit 0.
- Live localhost: health 200, hostile Origin 403, dashboard assets, run creation/failure events, MCP initialization, and canonical MCP tool listing verified.
- Codex: a real `codex exec` structured decision returned the requested final answer after strict-schema correction.
- Plugin: Codex 0.144.5 accepted the local marketplace and installed `winyolo@winyolo-local` on the server.
- Windows relay: the polling process detected the powered-on PC, deployed successfully, and exited after `WINYOLO_WINDOWS_DEPLOY_OK`.
- 2026-07-20 initial state: native-PC evidence was pending while the configured Windows host was powered down; the unattended relay later completed after the host came online.
- ISC-17: native Windows smoke — a 4096-character PowerShell result was capped at 256 bytes and returned `truncated: true`.
- ISC-18: native Windows smoke — `Start-Sleep -Seconds 5` with `timeout_ms: 250` returned `timedOut: true`.
- ISC-28: deferred live-browser probe — FOLLOWUP-WINYOLO-UI-1 requires an Interceptor screenshot; host-local HTTP verified task, approval, timeline, EventSource, risk, and output surfaces.
- ISC-29: native CLI probe — `winyolo.cmd doctor` reported win32 10.0.19045, Bun 1.3.14, PowerShell, Codex 0.144.6 path, missing API key, loopback, and data directory.
- ISC-30: native CLI probe — `winyolo.cmd demo` returned `ok: true` CIM data for DESKTOP-U1J1HF8 and a high-risk protected-root confirmation fixture.
- ISC-34: native install/launcher probe — `scripts\\install.ps1` exited 0 and the resulting `winyolo.cmd doctor` and `winyolo.cmd demo` both ran successfully from a fresh SSH shell.
- ISC-35: native Windows smoke — 34 tests passed and the script printed `WINYOLO_WINDOWS_SMOKE_OK` across direct and relay-driven verification runs; see `docs/evidence/windows-smoke-2026-07-20.md`.
- ISC-13.1: deferred authenticated-provider probe — FOLLOWUP-WINYOLO-AUTH-1 requires an OpenAI API key on the Windows host; current failure is explicit: `OPENAI_API_KEY is required for provider 'openai'.`
- ISC-31.1: deferred authenticated-provider probe — FOLLOWUP-WINYOLO-AUTH-2 requires `codex login` on the Windows host; Codex CLI 0.144.6 currently reports `Not logged in`.
- ISC-32: Windows MCP/HTTP integration probe — all direct tools now create RunManager-owned receipt runs; local, server, and Windows suites pass with 34 tests.
- ISC-32.1: native Windows MCP probe — a safe temporary-file action became `awaiting_confirmation`, rejected `CONFIRM WRONG`, accepted the manager nonce, deleted only the bound fixture, and recorded `approval.required`, `approval.accepted`, `tool.completed`, and `run.completed`.
- ISC-32.2: MCP schema and native call probe — `tools/list` contains MCP-only `win_confirm`, OpenAI `TOOL_DEFINITIONS` excludes it, and Windows smoke completed approval through the control tool.
- ISC-37: deferred Windows live probe — FOLLOWUP-WINYOLO-WIN-3 requires launching `winyolo` on native Windows and confirming the official TUI, inherited terminal behavior, Ctrl-C, and child exit status.
- ISC-38–47: `bun test test/codex-launcher.test.ts` plus CLI probes — exact YOLO/Safe argv, component overrides, resume/fork/archive/image/model/search/profile/cd/config pass-through, exit code 23 propagation, detached health-gated service start, native Codex help parsing, and doctor diagnostics pass.
- ISC-48–50: deferred Windows installer probe — FOLLOWUP-WINYOLO-WIN-4 requires two native runs of `scripts\\install.ps1`, `Get-Command winyolo.cmd`, plugin-list confirmation, and user-PATH persistence; deployment could not start because `WINYOLO_WINDOWS_HOST` and `WINYOLO_WINDOWS_USER` were absent.
- ISC-51–57: `bun test test/codex-gateway.test.ts` — initialize/initialized handshake, fragmented JSONL, out-of-order correlation, notification isolation, malformed diagnostics, shutdown rejection, two-restart ceiling, version health, and redaction pass.
- ISC-58–64: real `codex app-server` + gateway tests — native list/search/read/archive/unarchive/start/resume/turn/interrupt methods use generated 0.144.5 protocol shapes; bounded HTTP errors and secrets are redacted.
- ISC-65–74: `bun test test/codex-http.test.ts` and live localhost probes — validation, 404 mapping, archive state, Safe/YOLO thread and turn policy, local image shape, approvals, interrupt, SSE replay, and cursor recovery pass.
- ISC-68–73: authenticated real app-server E2E — thread `019f807a-fa74-7e60-9d74-adcfa952e009` completed with assistant text `WINYOLO_E2E_OK`; SSE delivered deltas and completion, then the thread archived successfully.
- ISC-72: authenticated live interrupt — turn `019f8084-6b7b-7c13-ade2-5422e106beab` reached `inProgress`, `turn/interrupt` returned `ok: true`, and authoritative `thread/read` settled at `status: interrupted` with no error.
- ISC-74: service-restart probe — archived search after Bun restart returned exactly one matching `WINYOLO_E2E_OK` thread, proving durable Codex history without conversation duplication.
- ISC-75–81: deferred real-Chrome probe — FOLLOWUP-WINYOLO-UI-2 requires Interceptor history navigation, transcript metadata, resume copy, composer, YOLO warning, Audit tab, streaming, refresh, approval, and interrupt checks; `interceptor` is not installed in this environment.
- ISC-82: `bun test` redaction fixtures plus live response scan — REST, JSON-RPC results, stderr, and SSE recursively redact keys and bearer tokens.
- ISC-83: `rg -i 'sessions|archived_sessions|\\.jsonl|CODEX_HOME' src` — only WinYOLO's separate `runs/<id>.jsonl` journal and browser `sessionStorage` match; no Codex private-session reader exists.
- ISC-84: `rg` across `cli.ts`, `codex-launcher.ts`, `codex-gateway.ts`, and `codex-http.ts` returned zero WSL, Bash, or `\\wsl$` runtime invocations.
- Build gate: `bun run check` — TypeScript clean, 49 tests passed, plugin validator printed `PLUGIN_VALID winyolo@0.2.0`, and `git diff --check` returned no errors.
- ISC-85: file read — `docs/FEATURE-AUDIT.md` assigns Implemented, Partial, Missing, or Deferred verification to every supplied recommendation group.
- ISC-86: `rg` evidence scan — every Implemented row names concrete source, test, script, or recorded evidence paths.
- ISC-87: file read — the audit says recognized destructive behavior is advisory policy and explicitly rejects a system-wide “Safe YOLO” guarantee.
- ISC-88: repository search — disposable execution environments are marked Missing with no implementation found.
- ISC-89: repository search — Git checkpoints and automatic rollback are marked Missing with no orchestrator found.
- ISC-90: source comparison — loopback/redaction are distinguished from absent YOLO network and secret-access enforcement.
- ISC-91: source comparison — native shell access is marked Partial for Visual Studio/MSBuild/.NET/NuGet/WinGet/SDK and other Windows-specialized surfaces.
- ISC-92: repository search — no WSL comparison harness or recorded measurements exist, and the audit forbids comparative numbers.
- ISC-93: timeline read — `docs/DEMO.md` and `WINDOWS-DEMO-AND-STORY.txt` both end at `2:50`.
- ISC-94: command-symbol scan — `serve`, `doctor`, `demo`, `safe`, `check`, and Windows smoke commands resolve to current CLI/package surfaces.
- ISC-95: file read — the protected-root demo is described as assessment-only and explicitly forbids approval or execution.
- ISC-96: narrative read — the one-line and closing stories consistently say “Windows-native launcher and transparent companion for Codex.”
- ISC-97: narrative read — disposable execution, rollback, policy enforcement, and deep Windows tooling are isolated under roadmap/not-current-claims sections.
- ISC-98: file read — root `WINDOWS-DEMO-AND-STORY.txt` contains prerequisites, installation, recording, exact script, guardrails, fallbacks, shutdown, logs, and submission actions.
- ISC-98.1: remote hash — after adding launcher recovery, local and `DESKTOP-U1J1HF8` copies both returned SHA-256 `202f15fb4be1c9aca9d3a9d4fd588bb779ebbca9316a7833078d0c76d1ab7232`.
- ISC-99: file read — the operator guide covers login failure, companion failure, slow model response, missing receipt, failed tests, and controlled shutdown.
- ISC-100: claim scan — native Windows TUI and real-Chrome acceptance remain explicitly deferred and are listed among claims the operator must not make.
- Audit-package build gate: `bun run check` — TypeScript clean, 49 tests passed, 155 expectations passed, and plugin validation printed `PLUGIN_VALID winyolo@0.2.0`.
- PC source prerequisite: remote read — `C:\Users\NickT\AI\Project\WinYOLO\package.json` reports `0.1.0`; the copied operator guide requires syncing 0.2.0 before recording.
- ISC-101: screenshot plus native probe — bare `winyolo` was unresolved before repair while `winyolo.cmd` existed only in the current project directory.
- ISC-102–103: native backup probe — `C:\Users\NickT\AI\Project\WinYOLO-pre-0.1-20260720-1422.tar` exists, hashes to `7a2b9357fb16f91c6c234b71c983197c9e6d83e79bf89ff4938b00517b1910a3`, and its package manifest reports 0.1.0.
- ISC-104: deployed file read — the active Windows package manifest reports 0.2.0.
- ISC-105: native hash probe — `.env` remained `a96f1741b8c8e952a5c65160c949462f0028a6f17ce9261d33432e277ce47941` before and after deployment.
- ISC-106–107: native installer probes — two consecutive installs exited 0; user PATH contains the project root once and the installer created `C:\Users\NickT\.bun\bin\winyolo.cmd` idempotently.
- ISC-108: fresh PowerShell probe outside the repository — `%TEMP%` resolved bare `winyolo` to `C:\Users\NickT\.bun\bin\winyolo.cmd` and printed `WINYOLO_FRESH_POWERSHELL_OK`.
- ISC-109–111: native smoke launcher probes — bare `winyolo doctor`, `winyolo --version`, and `winyolo safe --help` exited successfully; version output was `codex-cli 0.144.6`.
- ISC-112–113: full native Windows smoke — exit 0, `49 pass`, `155 expect() calls`, `PLUGIN_VALID winyolo@0.2.0`, and `WINYOLO_WINDOWS_SMOKE_OK`.
- ISC-114–115: operator-guide read — current-session PATH refresh and the explicit `.\winyolo.cmd doctor` fallback are present in `WINDOWS-DEMO-AND-STORY.txt`.
- ISC-116: identity read and response correction — `DA_IDENTITY.md` identifies NAR; `PAI` was stale assistant template text, not a configuration or routing change.
- ISC-117–121: `bun test test/codex-launcher.test.ts test/codex-gateway.test.ts test/codex-http.test.ts` — Safe default, constrained YOLO, rejected full-access forms, and browser parity pass.
- ISC-122–124: `bun test test/checkpoints.test.ts` — real Git repository fixture preserves dirty/untracked source state, exports the isolated delta, accepts it, and rejects non-Git input with remediation.
- ISC-125: TypeScript read and typecheck — `win32-broker.ts` binds `CreateProcessWithLogonW`, inherited output handles, kill-on-close Job Object policy, process assignment, timeout termination, and bounded redacted output.
- ISC-127–129: source and hook probe — sanitized runner environment excludes credential variables; `.env` is withheld; synthetic `.env` access exits 2 and writes a redacted schema-2 receipt.
- ISC-130–131: `bun test test/journal.test.ts` — new receipts persist schema 2 and a schema-1 fixture reads with new fields as null.
- ISC-132–136: `bun test test/windows-structured.test.ts` — nine strict schemas, bounded Event Log validation, exact package ID requirement, protected-service block, registry allowlist, and encoded path input pass.
- ISC-137: `bun test test/server.test.ts` — isolation, checkpoint, and capabilities endpoints respond on loopback and hostile Origin receives 403.
- ISC-138: static asset read — composer defaults Safe and presents Safe, constrained YOLO, and Isolated indicators plus stream, Interrupt, Accept, Rollback, patch path, and diff hash.
- ISC-139: installer read — `-Full` self-elevates once, installs native prerequisites, creates/reuses the runner, writes DPAPI ciphertext, applies ACLs, installs plugin/hooks, and copies the full operator guide.
- ISC-140–141: `bun run scripts/source-scan.ts` — prints `SOURCE_SCAN_OK`; only the dynamically imported, exact-confirmation benchmark module contains comparison transport code.
- ISC-142: fixture read — BrokenBuild solution contains a deterministic subtraction defect, one addition test, broken/fixed fixtures, reset, and verification commands.
- ISC-145: guide read — `WINDOWS-FULL-IMPLEMENTATION-STEPS.txt` contains all ten required operator sequences and exact commands.
- Build gate 0.3: `bun run check` — TypeScript clean, 57 tests and 197 expectations passed before hook/profile additions; plugin validator printed `PLUGIN_VALID winyolo@0.3.0`; production scan passed.
- Final local gate 0.3: `bun run check` — TypeScript clean, 61 tests and 217 expectations passed; plugin validator printed `PLUGIN_VALID winyolo@0.3.0`; production source scan, dashboard browser build, and `git diff --check` passed.
- Recovery hardening: `test/isolation.test.ts` proves persisted `running` state rehydrates as `interrupted`, appends a recovery event, and rewrites durable state after backend restart.
- Strict-tool hardening: action-specific required fields now fail validation before policy or execution while nullable unused fields preserve the Codex strict-schema contract.
- Credential/profile hardening: machine-scope DPAPI remains protected by installing-user/SYSTEM ACLs, and the broker now preserves the sanitized runner `USERPROFILE` while filtering credential variables.
- Advisor retry: the final smart review timed out after 90 seconds without findings; the earlier three concrete findings were resolved by code and deterministic tests, but this timeout is not counted as independent clearance.
- Browser gate: Interceptor invocation — executable is unavailable in this environment, so ISC-144 remains `FOLLOWUP-WINYOLO-UI-3` and no Chrome claim is made.
- Native gate: current host is not Windows, so ISC-126/143 remain `FOLLOWUP-WINYOLO-WIN-5` for FFI, ACL, credential, network, child-survival, full installer, and native smoke evidence.
- ISC-146: native PowerShell checkpoint probe — rollback returned schema 2 with `status: rolled_back`; subsequent port probe confirmed stale PID 14920 stopped and no listener remained.
- ISC-147: native process timestamp probe — replacement PID 18348 started `2026-07-21T15:42:23-04:00`, after fixed source timestamp `2026-07-21T15:20:09-04:00`.
- ISC-148.1: schema-2 receipt probe — run `215525e2-beb3-4dc4-939b-792c48948d12` recorded `codex.exe --ask-for-approval never exec` before exec-specific options.
- ISC-149: checkpoint correlation probe — run `215525e2-beb3-4dc4-939b-792c48948d12` produced matching `cp-215525e2-beb3-4dc4-939b-792c48948d12`.
- ISC-152: native release command — `bun run check` exited 0 with `63 pass`, `0 fail`, and `221 expect() calls`.
- ISC-153: native smoke log probe — captured output contained `SOURCE_SCAN_OK=True`.
- ISC-154: native smoke log probe — captured output contained `WINYOLO_WINDOWS_SMOKE_OK=True`.
- ISC-155: doctor probe — `Job Object    native broker ready`.
- ISC-155.1: doctor probe — `Runner        WinYOLORunner`, DPAPI secret present, and sandbox profiles generated.
- ISC-155.2: doctor probe — Git resolved to `C:\Program Files\Git\cmd\git.exe`.
- ISC-155.3: doctor probe — .NET resolved to `C:\Program Files\dotnet\dotnet.exe`.
- ISC-155.4: doctor probe — MSBuild resolved to Visual Studio 2022 Build Tools.
- ISC-155.5: doctor probe — WinGet resolved to the WindowsApps executable alias.
- ISC-155.6: doctor probe — Windows SDK resolved under `Windows Kits\10\bin`.
- ISC-156.1: SHA-256 read-back — local, Windows project, and Windows Desktop guides all hash to `3DD4222087517D545DC766456EB11FCA8DD6977AFCF5EE484FD243E9AD9A4C42` and contain section 17 with the observed 401 and rollback.
- ISC-158: checkpoint-state audit — both failed submission-day checkpoints were rolled back; neither was accepted.
- ISC-157: native demo reset — `bun run demo:reset` exited 0 and printed `BROKEN_BUILD_RESET`.
- ISC-157.1: native baseline probe — `bun run demo:verify` exited 1 with `Expected: 5`, `Actual: -1`, one failed test, and zero passed.
- ISC-158.1: submission claim scan — `docs/SUBMISSION.md` lists passed Windows gates and explicitly says isolated execution, full BrokenBuild, and Interceptor acceptance are not yet accepted.
- Advisor: final independent review — concluded `source/baseline/smoke validated`, while missing runner credential, browser evidence, video, and clean release provenance prevent a release-ready claim.
- ISC-159–167: source, ACL, and deterministic probes — explicit runner auth provisioning, dedicated `CODEX_HOME`, secret-path hook protection, traverse-only profile access, native sandbox-group workspace access, self-contained disposable clones, and 66 passing tests verified without displaying credentials or rerunning the toolchain.
- ISC-148/150/151 and ISC-169–172: native accepted proof — run `8d6c8af1-d36d-419f-93c1-204d4423a3e7` completed with exit 0; checkpoint `cp-8d6c8af1-d36d-419f-93c1-204d4423a3e7` diffed only `isolated-proof.txt`, hash `29481c089cdba26c5fc66bc4eb5f67fc183dbc334ec085a7574a392b7f2b8aad`, and accepted bytes `4F4B0A`.
- ISC-152–155: final Windows gates — `66 pass`, `0 fail`, `240 expect() calls`, `PLUGIN_VALID winyolo@0.3.0`, `SOURCE_SCAN_OK`, `WINYOLO_WINDOWS_SMOKE_OK`, runner login authenticated, and native broker/Git/.NET/MSBuild/WinGet/SDK ready.
- ISC-157.2–157.4 and ISC-173–175: BrokenBuild demo — wrong multiplication run `b5642ba1-db72-49d9-b617-966a33cc9951` rolled back; correct run `cb89623d-ccd0-411f-a6f2-8c835f62f4b8` accepted one source-file change with hash `4914321258ec634c95f98719386d93721eb99f02098173690b4c74f481e6aafa`; final output `BROKEN_BUILD_TESTS_PASS`.
- Submission artifacts: Windows Desktop ZIP `WinYOLO-submission-2026-07-21-1650.zip` hashes to `31864CF2FDEDF164B46318521056723517C3B67A1A50BC97EB1E0CAA883B35CC`; 36-second 1280x720 video `WinYOLO-demo.mp4` hashes to `276D5EA674D4FA8E312CE8C9320D20ACE173CF9C051D30CCF0C000ED992806C6`.
