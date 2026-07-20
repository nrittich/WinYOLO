# Three-minute demo

## Preparation

1. Run `scripts\install.ps1` and set `OPENAI_API_KEY`.
2. Start `.\winyolo.cmd serve`.
3. Open the dashboard and keep a terminal beside it.
4. Confirm `.\winyolo.cmd doctor` is readable and fully redacted.
5. Keep `scripts\smoke-windows.ps1` as the deterministic fallback.

## Script

**0:00–0:20 — Problem**

“Codex already works on Windows. WinYOLO makes native Windows automation visible: one timeline for what the model proposed, what PowerShell ran, what it returned, and where local confirmation stopped a dangerous action.”

**0:20–0:40 — Native proof**

Show `winyolo.cmd doctor`: Windows, Bun, Windows PowerShell, Codex, loopback endpoint. State explicitly that there is no WSL dependency.

**0:40–1:40 — Useful workflow**

Submit: “Inspect this Windows development environment. Check the OS, developer tools, disks, and processes listening on common development ports. Summarize anything that could block a Bun application.”

Show native inspection calls and outputs entering the receipt.

**1:40–2:15 — Visible execution**

Open one event’s details. Point out exact tool arguments, reason, risk level, exit code, timing, output, and truncation state. Open the matching JSONL receipt in `%LOCALAPPDATA%\WinYOLO\runs`.

**2:15–2:45 — YOLO checkpoint**

Use the deterministic `winyolo.cmd demo` fixture or ask for deletion of the deliberately nonexistent `C:\Windows\System32\winyolo-demo-never-created` path. Show that WinYOLO pauses before spawn, rejects incorrect confirmation, and requires the action-bound phrase. Reject the action; never modify a real protected path.

**2:45–3:00 — Codex connection**

Show the WinYOLO plugin in Codex and its native inspection tools. Close with: “Windows-native, no WSL, one auditable authority.”
