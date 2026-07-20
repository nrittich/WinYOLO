---
name: windows-native-control
description: Use WinYOLO to inspect or operate a Windows PC with native PowerShell, cmd, filesystem, and process tools while preserving a visible local receipt.
---

# Windows Native Control

Use the `winyolo` MCP tools whenever the user wants to inspect, diagnose, configure, or automate the local Windows PC through WinYOLO.

## Workflow

1. Call `win_system_inspect` before assuming machine state.
2. Prefer `win_filesystem` and `win_process` when they express the action.
3. Use `win_shell` for native PowerShell or cmd tasks that need broader control.
4. Never request WSL, bash, Linux paths, UAC elevation, registry mutation, drivers, or GUI automation.
5. A high-risk MCP call remains pending while WinYOLO displays it in the localhost dashboard. Tell the user to review it there. Never call `win_confirm`, derive, invent, or submit a confirmation phrase yourself; that MCP-only control tool is reserved for trusted local confirmation clients.
6. Finish with the commands used, observed result, and verification evidence.

WinYOLO's command classifier is advisory rather than a security sandbox. Treat its risk explanation as local review context, not proof that arbitrary PowerShell is safe.
