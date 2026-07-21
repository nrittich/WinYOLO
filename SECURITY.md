# Security model

WinYOLO exposes no unrestricted mode. Safe and YOLO both use Codex `workspace-write`; Safe requests approvals and YOLO rejects/contains boundary escalation without prompts. Command networking is denied unless an operator explicitly configures an allowlisted native proxy profile.

Isolated mode adds an OS identity and recovery boundary: `WinYOLORunner`, DPAPI-protected broker credential, protected data ACLs, sanitized environment, `CreateProcessWithLogonW`, a kill-on-close Job Object, and a disposable Git worktree. The source repository is never the isolated working directory.

Structured Windows operations receive exact target policy. Protected services, system/device namespaces, compatibility transports, secret paths, and non-allowlisted registry writes are blocked. Package, service, and ACL mutations require exact approval outside isolation. Raw PowerShell and cmd remain available only inside the current Codex sandbox.

The loopback server rejects hostile Origins, bounds/redacts output, and never returns runner credentials, provider authentication, raw environments, transcript paths, or app-server stdio. Codex owns transcripts; WinYOLO stores only schema-versioned execution receipts.

These controls do not make raw `codex` invocations part of WinYOLO. They also do not replace endpoint protection or Windows administrator policy. Run the adversarial native smoke before release and report failures without attaching credentials or personal receipts.
