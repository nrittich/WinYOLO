# WinYOLO 0.3

WinYOLO is a Windows-native launcher, isolation runner, and loopback companion for the official Codex CLI. It never uses a Linux compatibility layer in production.

## Modes

```text
winyolo [codex arguments]          Safe Codex TUI (workspace-write, on-request, network denied)
winyolo safe [codex arguments]     Compatibility alias for Safe
winyolo yolo [codex arguments]     Approval-free Codex TUI inside workspace-write
winyolo isolated "<task>"          Restricted-account job in a disposable Git worktree
winyolo checkpoint list
winyolo checkpoint diff <id>
winyolo checkpoint accept <id>
winyolo checkpoint rollback <id>
winyolo benchmark wsl --confirm BENCHMARK-ONLY
winyolo serve | doctor | demo
```

WinYOLO rejects `--yolo`, `--dangerously-bypass-approvals-and-sandbox`, and `sandbox_mode=danger-full-access`. Raw `codex` remains outside WinYOLO’s guarantees.

## Full installation

From an elevated-capable PowerShell session:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
& .\scripts\install.ps1 -Full
```

The script requests UAC once, installs or updates the native toolchain through WinGet, installs Codex and the plugin, creates `WinYOLORunner`, protects its DPAPI credential, and prepares `%LOCALAPPDATA%\WinYOLO`.

After installation, run `codex login`, then open `winyolo`, enter `/hooks`, and trust the five bundled hook definitions.

## Isolation and recovery

Isolated mode requires a Git repository with an initial commit. WinYOLO creates `%LOCALAPPDATA%\WinYOLO\workspaces\<run-id>`, copies the current tracked/dirty/untracked state into a checkpoint baseline without changing the source tree, withholds `.env` files, launches native `codex.exe exec` as `WinYOLORunner`, and assigns the process to a kill-on-close Job Object.

Every rollback exports `result.patch` before deleting the worktree. Accept refuses if the source repository changed since checkpoint creation.

## Structured Windows tools

The MCP exposes strict-schema tools for paths/reparse points, .NET, MSBuild/Visual Studio discovery, NuGet, WinGet, services, registry, Event Log, and NTFS ACLs. System mutations have typed risk assessments; protected services and non-allowlisted registry writes are blocked.

## Companion API

The Bun server binds to `127.0.0.1` and rejects hostile Origins. Codex’s official thread store remains transcript authority. New 0.3 endpoints cover isolation runs, event streams, interruption, accept/rollback, checkpoints, and Windows capabilities.

## Verification

```powershell
bun run check
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke-windows.ps1
```

See `WINDOWS-FULL-IMPLEMENTATION-STEPS.txt` for installation, Chrome acceptance, demo recording, rollback, and recovery.
