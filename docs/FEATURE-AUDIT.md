# WinYOLO 0.3 feature audit

Every row below is implemented in repository code. “Implemented” describes the shipped surface; the Windows acceptance column identifies the native probe that must pass before publishing binaries.

| Recommendation | Status | Repository evidence | Windows acceptance |
|---|---|---|---|
| Safe default and compatibility alias | **Implemented** | `src/codex-launcher.ts`, `src/cli.ts`, launcher tests | TUI starts workspace-write/on-request |
| Constrained approval-free YOLO | **Implemented** | launcher and gateway policy tests | TUI remains workspace-scoped |
| Reject unrestricted escalation | **Implemented** | `assertSafeBoundary`, receipt hook, tests | all three bypass forms fail |
| Native restricted-account process broker | **Implemented** | `src/win32-broker.ts` | `CreateProcessWithLogonW` succeeds |
| Kill-on-close Job Object | **Implemented** | `src/win32-broker.ts` | child-survival attack fails |
| DPAPI runner credential | **Implemented** | installer, `credential-store.ts` | credential ACL/read attacks fail |
| Disposable Git worktrees | **Implemented** | `src/checkpoints.ts`, checkpoint tests | dirty/untracked fixture passes |
| Patch export, accept, rollback | **Implemented** | checkpoint APIs/CLI/tests | interrupted/crashed recovery passes |
| Network denied by default | **Implemented** | launcher/gateway/isolation config | unapproved-domain probe fails |
| Secret-path denial | **Implemented** | hook policy, worktree secret withholding, ACL setup | profile/credential probes fail |
| Windows path and reparse inspection | **Implemented** | `win_path`, strict-schema tests | junction/loop/long-path fixtures pass |
| .NET restore/build/test | **Implemented** | `win_dotnet`, BrokenBuild demo | demo test sequence passes |
| Visual Studio/MSBuild/SDK discovery | **Implemented** | `win_msbuild`, full installer | installed toolchain reported |
| NuGet sources/packages/vulnerabilities | **Implemented** | `win_nuget` | native fixture queries pass |
| WinGet search/show/install/upgrade | **Implemented** | `win_winget`, typed approval policy | exact-id fixture passes |
| Service control with protected list | **Implemented** | `win_service`, policy tests | temporary-service round trip passes |
| Registry query and allowlisted write | **Implemented** | `win_registry`, policy tests | HKCU round trip passes |
| Bounded Event Log query | **Implemented** | `win_eventlog`, validation tests | provider/level/id/time fixture passes |
| Reversible NTFS ACL changes | **Implemented** | `win_acl`, approval policy | before/after/restore SDDL matches |
| Schema-2 append-only receipts | **Implemented** | journal/isolation/hooks, tests | native receipt contains bound identifiers |
| Schema-1 receipt compatibility | **Implemented** | `EventJournal.read`, journal test | legacy fixture loads with null fields |
| Trusted plugin lifecycle hooks | **Implemented** | `plugins/winyolo/hooks`, validator | `/hooks` shows five trusted hooks |
| Isolation/checkpoint/capability APIs | **Implemented** | `src/server.ts`, server tests | loopback/Origin probes pass |
| Isolated companion experience | **Implemented** | dashboard mode, stream, diff, accept/rollback | Interceptor sequence passes |
| Full one-UAC installer | **Implemented** | `scripts/install.ps1 -Full` | idempotent Win10 Home installs pass |
| Deterministic broken .NET demo | **Implemented** | `demo/BrokenBuild` | reset fails, repair passes |
| Explicit comparison benchmark | **Implemented** | quarantined `scripts/benchmark-compatibility.ts` | only exact confirmation launches it |
| Zero production compatibility dependency | **Implemented** | `scripts/source-scan.ts` | scan prints `SOURCE_SCAN_OK` |

Codex transcripts are not copied or parsed. Receipt hooks redact `transcript_path`, credentials, tokens, environment values, and authorization data.
