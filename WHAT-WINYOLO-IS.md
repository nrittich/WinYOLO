# What WinYOLO Really Is

WinYOLO is a Windows-native safety harness for AI coding agents, specifically
the official Codex CLI.

The simplest description is:

> WinYOLO lets Codex work autonomously inside a disposable Windows environment,
> then lets the developer inspect, accept, or reject the resulting patch.

Its central workflow is:

```text
Codex -> restricted Windows account -> disposable Git clone
      -> reviewable diff -> Accept or Rollback -> audit receipt
```

## What Was Built

WinYOLO is not another AI model or coding assistant. Codex still performs the
reasoning and coding. WinYOLO wraps Codex with operating-system controls and
recovery mechanisms:

- **Safe mode:** workspace-limited Codex with approvals.
- **YOLO mode:** approval-free operation while retaining boundaries.
- **Isolated mode:** Codex runs as a restricted Windows user inside a disposable
  repository clone.
- **Checkpointing:** every attempted change becomes an inspectable patch.
- **Accept and Rollback:** apply a reviewed patch or discard it while preserving
  evidence.
- **Process containment:** Windows Job Objects terminate associated child
  processes.
- **Secret protection:** environment sanitization, credential ACLs, and `.env`
  withholding.
- **Audit receipts:** records connect the run, process, checkpoint, result, and
  diff hash.
- **Windows tooling:** structured access to .NET, MSBuild, NuGet, WinGet,
  services, registry, Event Log, paths, and ACLs.
- **Local dashboard:** a browser interface for modes, runs, output, and
  decisions.

The central workflow was demonstrated rather than merely described: one
deliberately incorrect repair was rolled back, a correct repair was accepted,
and the repaired .NET tests passed. The repository also has 66 passing tests,
Windows smoke coverage, and source-safety checks.

## What Is Genuinely Valuable

The strongest idea is not simply "Codex on Windows." Codex already runs on
Windows.

The valuable idea is:

> Give an AI agent freedom inside a disposable boundary while keeping the final
> decision human and reversible.

That addresses a real developer problem. Constant approval prompts make agents
slow, but unrestricted execution can damage a working repository, expose
secrets, or run unwanted processes. WinYOLO attempts to provide autonomy
without immediately trusting the result.

The Windows-native focus is also meaningful. Many isolation workflows assume
Linux containers, WSL, or Unix sandboxing. WinYOLO combines Windows accounts,
DPAPI, NTFS permissions, Job Objects, Git isolation, and Codex into one
workflow.

The individual primitives already existed. The contribution is integrating
them into a coherent agent-development experience.

## Who Would Find It Useful

WinYOLO is most useful for:

- Windows developers who want Codex to attempt larger repairs autonomously.
- Developers working with .NET, Visual Studio, MSBuild, NuGet, and other native
  Windows tooling.
- People who want to inspect AI changes before they touch the real repository.
- Teams that need evidence showing what an agent ran and which patch was
  accepted.
- Developers testing uncertain or intentionally risky repair prompts.

It is less useful for:

- macOS or Linux developers.
- People already using disposable virtual machines or development containers.
- Small, low-risk changes where an ordinary Git branch is sufficient.
- Developers unwilling to configure a restricted Windows account and runner
  authentication.
- Organizations requiring a formally audited security boundary.

## Honest Maturity Assessment

As a hackathon project, WinYOLO is strong: ambitious, technically substantial,
and demonstrated with a real failure-and-recovery sequence.

As a tool developers should rely on today, it is still an early prototype.

The biggest limitations are:

- Installation and runner authentication are complicated.
- The security boundary has tests but has not undergone an independent security
  audit.
- It is Windows-specific and largely single-machine.
- Some functionality overlaps Codex's native sandboxing, Git worktrees,
  containers, and ordinary code review.
- The breadth of features can obscure the strongest feature: isolated,
  reviewable, reversible agent execution.
- The dashboard and operational recovery experience need more hardening.

Current assessment:

| Dimension | Assessment |
|---|---:|
| Engineering achievement | 8/10 |
| Usefulness for its target Windows audience today | 7/10 |
| Usefulness for the average developer today | 5/10 |
| Potential after product hardening | 8/10 |

## The Best Product Positioning

Avoid describing WinYOLO as an "Unlimited Windows Native Harness for Codex."
That sounds broader than the proven product.

A more accurate positioning is:

> **WinYOLO is a native Windows safety and recovery layer for autonomous Codex
> tasks.**

Or, more plainly:

> **Let Codex attempt the change. Review the patch. Accept it or roll it back.**

That is what WinYOLO really is, and it solves a legitimate problem. The next
challenge is turning a capable engineering prototype into something developers
can install, trust, and understand in five minutes.
