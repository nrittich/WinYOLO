# Build Week submission checklist

## Category

Developer Tools

## One-line description

WinYOLO is a transparent Windows-native automation control plane that lets GPT‑5.6 and Codex operate PowerShell, files, and processes with live receipts and destructive-action checkpoints—without WSL.

## Problem and impact

AI developer agents can execute powerful local commands, but Windows operators lack a compact, replayable explanation of what ran and why. WinYOLO makes native automation inspectable and gives developers one local control plane across API, CLI, dashboard, MCP, and Codex plugin surfaces.

## Technical implementation highlights

- GPT‑5.6 Responses API function calling with strict schemas and preserved call IDs.
- Native Windows PowerShell/cmd execution, bounded process lifetime, and output limits.
- Action-bound confirmations and append-only redacted receipts.
- Localhost SSE dashboard and Streamable HTTP MCP integration.
- Codex CLI structured-planning adapter behind the same authority.

## Materials

- [ ] Public repository URL and MIT license
- [ ] README setup instructions verified from a fresh Windows checkout
- [ ] Public YouTube demo under three minutes
- [x] Project description and Developer Tools category
- [ ] `/feedback` Codex session ID for the core build session
- [x] Notes explaining where Codex accelerated implementation and key human decisions
- [x] Test instructions that do not require rebuilding a hosted service
- [x] [Final Windows smoke receipt](evidence/windows-smoke-2026-07-20.md)

## Human decisions to highlight

1. Reframed the idea after verifying Codex already runs natively on Windows.
2. Kept raw PowerShell YOLO mode but described classification honestly as advisory.
3. Centralized authority so dashboard, API, MCP, and plugin cannot silently diverge.
4. Made the dangerous demo deterministic and non-destructive.
