import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.ts";
import { WinYoloAgent } from "./agent.ts";
import { EventJournal } from "./journal.ts";
import { redactValue } from "./redact.ts";
import type { ApprovalRequest, ProviderName, RunEvent, RunRecord } from "./types.ts";

interface AgentRunner {
  run: WinYoloAgent["run"];
}

interface ApprovalWaiter {
  approval: ApprovalRequest;
  resolve: (approved: boolean) => void;
}

export class RunManager {
  readonly #config: AppConfig;
  readonly #agent: AgentRunner;
  readonly #journal: EventJournal;
  readonly #runs = new Map<string, RunRecord>();
  readonly #waiters = new Map<string, ApprovalWaiter>();
  readonly #eventIds = new Map<string, number>();

  constructor(config: AppConfig, agent: AgentRunner = new WinYoloAgent(config), journal = new EventJournal(config.dataDir)) {
    this.#config = config;
    this.#agent = agent;
    this.#journal = journal;
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
      id: nextId,
      runId: run.id,
      at: now,
      type,
      message,
      ...(data ? { data: redactValue(data) } : {}),
    };
    run.updatedAt = now;
    run.events.push(event);
    await this.#journal.append(event);
  }

  async start(options: { task: string; provider?: ProviderName; cwd?: string }): Promise<RunRecord> {
    if (this.active()) throw new Error("active_run_exists");
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
    void this.#execute(run);
    return this.get(run.id)!;
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
    await this.#emit(run, "approval.required", "A high-risk action requires local confirmation.", {
      approval: redactValue(approval),
    });
    return new Promise<boolean>((resolve) => {
      this.#waiters.set(approval.id, { approval, resolve });
    });
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
