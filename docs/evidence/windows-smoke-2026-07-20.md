# Windows smoke receipt — 2026-07-20

## Target

- Machine: `DESKTOP-U1J1HF8`
- OS: Microsoft Windows 10 Home `10.0.19045`, 64-bit
- Project: `C:\Users\NickT\AI\Project\WinYOLO`
- Verified commit: `8077afb`
- Bun: `1.3.14`
- Codex CLI: `0.144.6`
- Plugin: `winyolo@winyolo-local` installed and enabled

## Command

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-windows.ps1
```

## Result

```text
34 pass
0 fail
94 expect() calls
PLUGIN_VALID winyolo@0.1.0
WINYOLO_WINDOWS_SMOKE_OK
WINYOLO_WINDOWS_DEPLOY_OK
```

The native smoke verified loopback health, hostile-Origin rejection, CIM inspection, bounded PowerShell output, command timeout handling, and the full MCP approval cycle. A safe temporary-file action became dashboard-visible and pending; `CONFIRM WRONG` did not execute it; the manager-issued exact phrase resumed only the stored call; the receipt contained `approval.required`, `approval.accepted`, `tool.completed`, and `run.completed`.

## Remaining operator prerequisites

- `OPENAI_API_KEY` is not set on the PC, so the authenticated GPT-5.6 probe remains deferred.
- Codex is installed but reports `Not logged in`; run `codex login` before using the Codex planner.
- Real-Chrome dashboard screenshot verification remains deferred until Interceptor is installed.
