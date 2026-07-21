import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.ts";
import { WinYoloAgent } from "./agent.ts";
import { EventJournal } from "./journal.ts";
import { ToolAuthority } from "./executor.ts";
import { redactValue } from "./redact.ts";
import type { ApprovalRequest, PolicyAssessment, ProviderName, RunEvent, RunRecord, ToolCall, ToolResult } from "./types.ts";

interface AgentRunner {
  run: WinYoloAgent["run"];
}

interface ApprovalWaiter {
  approval: ApprovalRequest;
  resolve: (approved: boolean) => void;
}

interface ToolExecutor {
  assess: ToolAuthority["assess"];
  execute: ToolAuthority["execute"];
}

export interface ManagedToolResult {
  runId: string;
  result: ToolResult;
}

export class RunManager {
  readonly #config: AppConfig;
  readonly #agent: AgentRunner;
  readonly #journal: EventJournal;
  readonly #authority: ToolExecutor;
  readonly #runs = new Map<string, RunRecord>();
  readonly #waiters = new Map<string, ApprovalWaiter>();
  readonly #eventIds = new Map<string, number>();

  constructor(
    config: AppConfig,
    agent: AgentRunner = new WinYoloAgent(config),
    journal = new EventJournal(config.dataDir),
    authority: ToolExecutor = new ToolAuthority(config),
  ) {
    this.#config = config;
    this.#agent = agent;
    this.#journal = journal;
    this.#authority = authority;
  }

  active(): RunRecord | undefined {
    return [...this.#runs.values()].find((run) =>
      run.status === "queued" || run.status === "running" || run.status === "awaiting_confirmation"
    );
  }

  get(id: string): RunRecord | undefined {
    const run = this.#runs.get(id);
    return run ? redactValue(structuredClone(run)) : undefined;
  }

  list(): RunRecord[] {
    return [...this.#runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((run) => redactValue(structuredClone(run)));
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    return this.#journal.subscribe(runId, listener);
  }

  async #emit(
    run: RunRecord,
    type: RunEvent["type"],
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const nextId = (this.#eventIds.get(run.id) ?? 0) + 1;
    this.#eventIds.set(run.id, nextId);
    const now = new Date().toISOString();
    const event: RunEvent = {
      schema: 2,
      id: nextId,
      runId: run.id,
      at: now,
      type,
      message,
      sessionId: null,
      threadId: null,
      turnId: null,
      toolCallId: typeof data?.callId === "string" ? data.callId : null,
      checkpointId: null,
      processId: null,
      command: null,
      cwd: run.cwd,
      risk: (data?.assessment as PolicyAssessment | undefined)?.risk ?? null,
      approvalSource: type.startsWith("approval.") ? "local-user" : null,
      durationMs: (data?.result as ToolResult | undefined)?.durationMs ?? null,
      exitStatus: (data?.result as ToolResult | undefined)?.exitCode ?? null,
      outputBytes: null,
      finalDiffHash: null,
      ...(data ? { data: redactValue(data) } : {}),
    };
    run.updatedAt = now;
    run.events.push(event);
    await this.#journal.append(event);
  }

  async start(options: { task: string; provider?: ProviderName; cwd?: string }): Promise<RunRecord> {
    if (this.active()) throw new Error("active_run_exists");
    const run = await this.#createRun(options);
    void this.#execute(run);
    return this.get(run.id)!;
  }

  async #createRun(options: { task: string; provider?: ProviderName; cwd?: string }): Promise<RunRecord> {
    const now = new Date().toISOString();
    const run: RunRecord = {
      id: randomUUID(),
      task: options.task.trim(),
      provider: options.provider ?? this.#config.provider,
      cwd: options.cwd?.trim() || this.#config.defaultCwd,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      events: [],
    };
    this.#runs.set(run.id, run);
    await this.#emit(run, "run.created", "Run created.", { provider: run.provider, cwd: run.cwd });
    return run;
  }

  async executeTool(options: {
    call: ToolCall;
    cwd?: string;
    source: "mcp" | "http";
  }): Promise<ManagedToolResult> {
    if (this.active()) throw new Error("active_run_exists");

    // Bind an immutable copy before assessment. Confirmation only releases this
    // stored call; callers never get a second opportunity to replace arguments.
    const call = structuredClone(options.call);
    const cwd = options.cwd?.trim() || this.#config.defaultCwd;
    const run = await this.#createRun({
      task: `${options.source.toUpperCase()} tool: ${call.name}`,
      provider: this.#config.provider,
      cwd,
    });
    run.status = "running";
    await this.#emit(run, "run.started", `${options.source.toUpperCase()} direct-tool run started.`, {
      source: options.source,
    });

    const assessment = this.#authority.assess(call, cwd);
    await this.#emit(run, "tool.proposed", `${call.name}: ${assessment.reasons.join(" ")}`, {
      source: options.source,
      call: redactValue(call),
      assessment,
    });

    if (assessment.decision === "block") {
      const error = assessment.reasons.join(" ");
      const result: ToolResult = {
        ok: false,
        tool: call.name,
        error,
        assessment,
      };
      run.error = error;
      run.status = "failed";
      await this.#emit(run, "tool.failed", `${call.name} was blocked.`, { result });
      await this.#emit(run, "run.failed", "Direct-tool run failed.", { error: result.error });
      return { runId: run.id, result: redactValue(result) };
    }

    let confirmed = false;
    if (assessment.decision === "confirm") {
      const localAssessment = {
        ...assessment,
        confirmationPhrase: `CONFIRM ${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
      };
      const approval: ApprovalRequest = {
        id: randomUUID(),
        runId: run.id,
        call,
        assessment: localAssessment,
        createdAt: new Date().toISOString(),
      };
      confirmed = await this.#requestApproval(run, approval);
      await this.#emit(
        run,
        confirmed ? "approval.accepted" : "approval.rejected",
        confirmed ? "Local confirmation accepted." : "Local confirmation rejected.",
        { approvalId: approval.id, fingerprint: assessment.fingerprint },
      );
      if (!confirmed) {
        const result: ToolResult = { ok: false, tool: call.name, error: "user_rejected", assessment };
        run.status = "cancelled";
        await this.#emit(run, "tool.failed", `${call.name} was rejected without execution.`, { result });
        return { runId: run.id, result: redactValue(result) };
      }
    }

    await this.#emit(run, "tool.started", `Executing ${call.name}.`, { callId: call.callId });
    let result: ToolResult;
    try {
      result = await this.#authority.execute(call, cwd, confirmed);
    } catch (error) {
      result = {
        ok: false,
        tool: call.name,
        error: error instanceof Error ? error.message : String(error),
        assessment,
      };
    }
    await this.#emit(
      run,
      result.ok ? "tool.completed" : "tool.failed",
      result.ok ? `${call.name} completed.` : `${call.name} failed.`,
      { callId: call.callId, result: redactValue(result) },
    );
    run.answer = JSON.stringify(redactValue(result));
    run.status = result.ok ? "completed" : "failed";
    if (!result.ok) run.error = result.error ?? "tool_failed";
    await this.#emit(
      run,
      result.ok ? "run.completed" : "run.failed",
      result.ok ? "Direct-tool run completed." : "Direct-tool run failed.",
      result.ok ? { result: redactValue(result) } : { error: run.error },
    );
    return { runId: run.id, result: redactValue(result) };
  }

  async #execute(run: RunRecord): Promise<void> {
    run.status = "running";
    await this.#emit(run, "run.started", "WinYOLO started the task.");
    try {
      const answer = await this.#agent.run(
        { runId: run.id, task: run.task, cwd: run.cwd, provider: run.provider },
        {
          emit: (type, message, data) => this.#emit(run, type, message, data),
          requestApproval: (approval) => this.#requestApproval(run, approval),
        },
      );
      run.answer = answer;
      run.status = "completed";
      await this.#emit(run, "run.completed", "Run completed.", { answer });
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
      run.status = "failed";
      await this.#emit(run, "run.failed", "Run failed.", { error: run.error });
    }
  }

  async #requestApproval(run: RunRecord, approval: ApprovalRequest): Promise<boolean> {
    run.status = "awaiting_confirmation";
    run.pendingApproval = approval;
    // Register the waiter before exposing the pending state through the
    // journal/dashboard. Otherwise a fast client can confirm during the emit
    // and receive a false mismatch because the approval is visible but not yet
    // actionable.
    const response = new Promise<boolean>((resolve) => {
      this.#waiters.set(approval.id, { approval, resolve });
    });
    await this.#emit(run, "approval.required", "A high-risk action requires local confirmation.", {
      approval: redactValue(approval),
    });
    return response;
  }

  confirm(runId: string, approvalId: string, decision: "approve" | "reject", confirmation = ""): boolean {
    const run = this.#runs.get(runId);
    const waiter = this.#waiters.get(approvalId);
    if (!run || !waiter || waiter.approval.runId !== runId) return false;
    const expected = waiter.approval.assessment.confirmationPhrase ?? "";
    if (decision === "approve" && confirmation.trim() !== expected) return false;
    this.#waiters.delete(approvalId);
    delete run.pendingApproval;
    run.status = "running";
    waiter.resolve(decision === "approve");
    return true;
  }
}
