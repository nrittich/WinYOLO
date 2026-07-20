# Security model

## Supported boundary

WinYOLO binds to loopback, rejects untrusted browser origins, keeps provider credentials server-side, redacts known credential shapes before persistence, caps output, limits agent steps, and refuses non-loopback configuration.

Recognized destructive shell or filesystem actions targeting Windows system roots require an exact local confirmation. Destructive shell commands whose targets cannot be resolved also require confirmation. WSL requests, UNC shares, and Windows device namespaces are rejected in v1.

## Non-goals

WinYOLO is not a PowerShell sandbox, endpoint protection product, or privilege boundary. Static inspection cannot reliably understand arbitrary PowerShell, nested processes, dynamic expressions, reparse points, environment expansion, short paths, mapped drives, or native binaries. Confirmation authorizes an attempted command; it does not elevate privileges or prove the command is safe.

Run WinYOLO unelevated on a machine and repository you trust. Do not expose its port beyond loopback.

## Reporting

Do not include API keys, personal file contents, or live system receipts in a public issue. Provide a minimal reproduction using a temporary fixture directory.
