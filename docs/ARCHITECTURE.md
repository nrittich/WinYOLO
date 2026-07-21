# Architecture

WinYOLO 0.3 has three execution boundaries.

1. The official interactive Codex TUI runs with workspace-write. Safe uses on-request approvals; YOLO uses never. Both deny command networking by default.
2. Browser conversations use the official app-server protocol with the same Safe/YOLO policies. Codex remains transcript authority.
3. Isolated tasks run `codex.exe exec` as `WinYOLORunner` in a disposable Git worktree. A native Bun FFI broker calls `CreateProcessWithLogonW`, assigns the process to a kill-on-close Job Object, sanitizes the environment, and redirects bounded output to the Bun server.

The launcher rejects every full-access escalation at its public boundary. The plugin’s `PreToolUse` hook independently rejects compatibility transports, device namespaces, secret paths, and unrestricted Codex flags.

`CheckpointManager` creates a branch/worktree from `HEAD`, overlays the source repository’s current tracked and non-secret untracked state, commits an isolated baseline, and calculates only the later task delta. Accept checks the original source-state hash before applying the patch. Rollback always exports the patch before removing the worktree and branch.

Schema-2 receipts bind session, thread, turn, tool call, checkpoint, process, and isolation run identifiers. They include risk, approval source, timing, exit status, bounded output size, and final diff hash. Schema-1 JSONL remains readable with absent fields normalized to `null`.

The server is loopback-only and applies Origin protection before every `/api/*` endpoint. It never returns the runner password, Codex authentication, raw child environment, or app-server stdio.
