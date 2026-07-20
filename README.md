# WinYOLO

**Move fast. See everything.**

WinYOLO is a transparent Windows-native automation control plane powered by GPT‑5.6 and Codex. It turns a natural-language task into native PowerShell, cmd, filesystem, process, and system-inspection actions while showing every proposal, risk label, result, and confirmation in a localhost dashboard.

It does not use WSL. It also does not pretend arbitrary PowerShell can be made safe with a regular expression. YOLO mode is intentionally powerful; recognized destructive actions that touch Windows system roots pause for a local, action-bound confirmation, and every step is written to a redacted JSONL receipt.

## Why it exists

Codex already runs natively on Windows. The missing piece WinYOLO targets is operational transparency: one Windows-resident authority shared by the API agent, terminal, dashboard, MCP server, and Codex plugin.

```text
GPT-5.6 Responses API ─┐
Codex CLI planner ─────┼─> WinYOLO agent loop
Codex plugin / MCP ────┘          │
                                  v
                         policy + confirmation
                                  │
                                  v
                  PowerShell / cmd / files / processes
                                  │
                                  v
                    live dashboard + JSONL receipt
```

## Windows quick start

Requirements:

- Windows 10 or 11
- [Bun](https://bun.sh/) 1.3 or newer
- An OpenAI API key for the GPT‑5.6 path
- Optional: Codex CLI for the secondary planner and plugin workflow

From native PowerShell:

```powershell
git clone <your-repository-url> WinYOLO
cd WinYOLO
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

Add the API key to `.env`, or set it for the current terminal:

```powershell
$env:OPENAI_API_KEY = "your-key"
```

Start the service:

```powershell
.\winyolo.cmd serve
```

Open <http://127.0.0.1:4747>. The API key stays in the Bun process and is never sent to browser JavaScript.

## CLI

```powershell
.\winyolo.cmd doctor
.\winyolo.cmd demo
.\winyolo.cmd run "Inspect this Windows development environment" --provider openai
.\winyolo.cmd run "Find what owns port 3000" --provider codex
```

`demo` needs no API key. It performs native system inspection, then classifies—but never executes—a deliberately nonexistent protected-root deletion.

## Core behavior

- GPT‑5.6 through the OpenAI Responses API with strict function schemas.
- Native Windows PowerShell 5.1 transport through UTF‑16LE `-EncodedCommand` and direct argv spawning.
- Native cmd support without a Unix shell intermediary.
- Structured filesystem, process, and CIM-based system inspection tools.
- Raw PowerShell YOLO mode with visible reasons and output.
- One active run, bounded steps, bounded command output, and process timeouts.
- Local action confirmation bound to the exact tool arguments and working directory hash.
- Loopback-only HTTP service, Origin checking, server-side secrets, and redacted receipts.
- SSE dashboard timeline and durable `.jsonl` run history.

## Safety model

WinYOLO is an automation harness, not a sandbox.

The policy engine recognizes common destructive syntax, extracts explicit Windows paths, canonicalizes them, and asks for confirmation when a recognized action targets `Windows`, `Program Files`, `Program Files (x86)`, `ProgramData`, boot, or recovery roots. Destructive commands with unresolved targets also require confirmation. UNC/device namespaces and WSL requests are blocked in v1.

Raw PowerShell can obscure intent through variables, child processes, encoded commands, .NET calls, reparse points, and many other mechanisms. The confirmation system is therefore an auditable checkpoint, not a security guarantee. Run WinYOLO unelevated and review its receipts.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Runtime status |
| `GET` | `/api/runs` | In-memory run history |
| `POST` | `/api/runs` | Start `{task, provider, cwd?}` |
| `GET` | `/api/runs/:id` | Run state and events |
| `GET` | `/api/runs/:id/events` | Server-sent event stream |
| `POST` | `/api/runs/:id/approvals/:approvalId` | Approve or reject a pending action |
| `GET` | `/api/tools` | Canonical tool schemas |
| `POST` | `/api/tools/execute` | Direct safe-tool execution for local integrations |
| `POST` | `/mcp` | Streamable HTTP MCP transport |

## Codex plugin

The repository contains a local Codex marketplace and plugin at `plugins/winyolo`. The plugin connects to the running service at `http://127.0.0.1:4747/mcp`; it does not create a second execution path.

```powershell
codex plugin marketplace add .
codex plugin add winyolo@winyolo-local
```

Start a new Codex thread after installation, then ask: `Use WinYOLO to inspect my Windows developer environment.`

The plugin deliberately cannot auto-confirm a dangerous action. Open the dashboard to review those actions locally.

## Verification

```powershell
bun run check
powershell -ExecutionPolicy Bypass -File scripts\smoke-windows.ps1
```

The smoke suite starts WinYOLO on a temporary port, verifies loopback health and hostile-Origin rejection, performs native inspection, and confirms the protected-root fixture stops before execution.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | none | Primary provider credential |
| `WINYOLO_MODEL` | `gpt-5.6` | Responses API model |
| `WINYOLO_PROVIDER` | `openai` | `openai` or `codex` |
| `WINYOLO_HOST` | `127.0.0.1` | Loopback host; non-loopback is refused |
| `WINYOLO_PORT` | `4747` | Local dashboard/API port |
| `WINYOLO_MAX_STEPS` | `20` | Maximum model tool calls |
| `WINYOLO_COMMAND_TIMEOUT_MS` | `120000` | Command timeout ceiling |
| `WINYOLO_MAX_OUTPUT_BYTES` | `200000` | Captured stdout/stderr limit |
| `WINYOLO_DATA_DIR` | `%LOCALAPPDATA%\WinYOLO` | Receipts and runtime data |

## Project status

WinYOLO is a Build Week MVP. See [ARCHITECTURE.md](docs/ARCHITECTURE.md), [DEMO.md](docs/DEMO.md), [SUBMISSION.md](docs/SUBMISSION.md), and [SECURITY.md](SECURITY.md).
