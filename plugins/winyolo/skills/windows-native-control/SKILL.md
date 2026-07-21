---
name: windows-native-control
description: Use WinYOLO for policy-aware native Windows paths, .NET, MSBuild, NuGet, WinGet, services, registry, Event Log, ACLs, processes, files, checkpoints, and isolated execution.
---

# Windows Native Control

Use WinYOLO structured tools before raw PowerShell when a schema covers the operation.

1. Inspect machine and target state before mutation.
2. Use `win_path` for canonicalization, target, reparse, and traversal checks.
3. Use the dedicated .NET/MSBuild/NuGet tools for build work.
4. Use exact package, service, registry, Event Log, and ACL targets.
5. Never attempt a Linux compatibility transport, device namespace, secret path, or unrestricted Codex escalation.
6. In Safe mode, let WinYOLO request exact approval for typed high-risk actions. In constrained YOLO, adapt when a boundary escalation is rejected.
7. Prefer `winyolo isolated` for autonomous changes requiring rollback.
8. Finish with commands, observed results, checkpoint/diff hash, and verification evidence.

Codex owns transcripts. WinYOLO owns redacted execution and isolation receipts; never parse private transcript files.
