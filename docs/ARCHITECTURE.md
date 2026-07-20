# Architecture

WinYOLO has one authority boundary: the Windows-resident Bun process. Every surface delegates to the same `ToolAuthority`, so policy, confirmation, process launch, output limits, redaction, and receipts cannot drift between the dashboard and plugin.

## Components

1. `OpenAIResponsesProvider` submits strict tools to `gpt-5.6`, retains response output items, and returns function outputs using the original `call_id`.
2. `CodexCliProvider` runs Codex in a read-only sandbox as a structured planner. It returns one typed tool proposal at a time; it does not execute Windows commands itself.
3. `WinYoloAgent` enforces the maximum tool-step count and routes every proposal through the authority.
4. `ToolAuthority` applies advisory policy and executes native tools.
5. `RunManager` enforces one active run and owns resumable in-process confirmations.
6. `EventJournal` redacts before appending JSONL and broadcasting SSE.
7. `server.ts` serves HTTP, MCP, SSE, and static dashboard assets on loopback.

## Responses tool loop

The input starts with the user task. Each Responses API output item is appended to the running input, preserving reasoning and function-call items. WinYOLO executes every function call, appends a stringified `function_call_output` carrying the same `call_id`, and sends the expanded input back to the model. The loop ends on final text or the configured tool limit.

## Confirmation binding

The policy fingerprint is SHA‑256 over `{tool name, exact arguments, cwd}`. The dashboard must submit `CONFIRM <first-eight-hex>` for the pending approval. A phrase from another action, working directory, or run cannot resume the call. Rejection returns a structured tool failure to the model so it can adapt.

## Native execution

PowerShell commands are UTF‑16LE base64 encoded and passed directly to `powershell.exe -EncodedCommand`. cmd commands are passed directly to `cmd.exe /d /s /c`. Bun never asks a host Unix shell to reinterpret those arguments. Output streams are drained concurrently, stored only up to the byte limit, and marked when truncated. On Windows timeout, WinYOLO calls `taskkill /T /F` before killing the parent process.
