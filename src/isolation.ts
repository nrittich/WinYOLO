import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./config.ts";
import { CheckpointManager, type CheckpointRecord } from "./checkpoints.ts";
import { readRunnerCredential } from "./credential-store.ts";
import { redactValue } from "./redact.ts";
import { resolveCodexExecutable } from "./codex-launcher.ts";
import { WindowsJobBroker, type BrokerResult } from "./win32-broker.ts";

export type IsolationStatus = "preparing" | "running" | "completed" | "failed" | "interrupted" | "accepted" | "rolled_back";
export interface IsolationEvent {
  schema: 2;
  id: number;
  runId: string;
  at: string;
  type: string;
  sessionId: string | null;
  threadId: string | null;
  turnId: string | null;
  toolCallId: string | null;
  checkpointId: string | null;
  processId: number | null;
  command: string[] | null;
  cwd: string | null;
  risk: string | null;
  approvalSource: string | null;
  durationMs: number | null;
  exitStatus: number | null;
  outputBytes: number | null;
  finalDiffHash: string | null;
  message: string;
  data?: Record<string, unknown>;
}
export interface IsolationRun {
  id: string;
  task: string;
  sourceCwd: string;
  status: IsolationStatus;
  checkpointId: string | null;
  processId: number | null;
  createdAt: string;
  updatedAt: string;
  error?: string;
  result?: BrokerResult;
  events: IsolationEvent[];
}

interface Broker { launch(options: Parameters<WindowsJobBroker["launch"]>[0]): Promise<BrokerResult>; interrupt(): boolean }

export function buildIsolatedCodexArgs(workspaceCwd: string, task: string): string[] {
  // `--ask-for-approval` is a top-level Codex option in current native Codex;
  // The process already runs inside the dedicated WinYOLORunner account, a
  // kill-on-close Job Object, and a disposable ACL-scoped clone. Native
  // Windows sandboxing cannot be nested reliably under that restricted logon,
  // so Codex receives full access only within the outer OS account boundary.
  return [
    "--ask-for-approval", "never", "exec", "--sandbox", "danger-full-access",
    "--config", "sandbox_workspace_write.network_access=false",
    "--config", 'windows.sandbox="elevated"',
    "--config", 'cli_auth_credentials_store="file"',
    "--config", "shell_environment_policy.ignore_default_excludes=false",
    "--config", 'shell_environment_policy.exclude=["CODEX_ACCESS_TOKEN","CODEX_API_KEY","OPENAI_API_KEY","*TOKEN*","*KEY*","*SECRET*"]',
    "--cd", workspaceCwd, task,
  ];
}

export class IsolationManager {
  readonly #config: AppConfig;
  readonly checkpoints: CheckpointManager;
  readonly #runs = new Map<string, IsolationRun>();
  readonly #brokers = new Map<string, Broker>();
  readonly #listeners = new Map<string, Set<(event: IsolationEvent) => void>>();
  readonly #brokerFactory: () => Broker;
  #hydrated = false;

  constructor(config: AppConfig, checkpoints = new CheckpointManager(config.dataDir), brokerFactory: () => Broker = () => new WindowsJobBroker()) {
    this.#config = config; this.checkpoints = checkpoints; this.#brokerFactory = brokerFactory;
  }

  async hydrate(): Promise<void> {
    if (this.#hydrated) return;
    this.#hydrated = true;
    const root = join(this.#config.dataDir, "isolation");
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      try {
        const saved = JSON.parse(await readFile(join(root, entry.name, "run.json"), "utf8")) as IsolationRun;
        saved.events = await this.eventsFromDisk(saved.id);
        if (saved.status === "running" || saved.status === "preparing") {
          saved.status = "interrupted"; saved.error = "backend_restarted";
          this.#runs.set(saved.id, saved);
          await this.#emit(saved, "isolation.interrupted", "Backend restart recovered an unfinished isolated run.", { risk: "constrained", data: { reason: "backend_restarted" } });
          continue;
        }
        this.#runs.set(saved.id, saved);
      } catch {}
    }
  }

  list(): IsolationRun[] { return [...this.#runs.values()].map((run) => redactValue(structuredClone(run))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id: string): IsolationRun | undefined { const run = this.#runs.get(id); return run ? redactValue(structuredClone(run)) : undefined; }
  subscribe(id: string, listener: (event: IsolationEvent) => void): () => void {
    const listeners = this.#listeners.get(id) ?? new Set(); listeners.add(listener); this.#listeners.set(id, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.#listeners.delete(id); };
  }
  async #emit(run: IsolationRun, type: string, message: string, fields: Partial<IsolationEvent> = {}): Promise<void> {
    const event: IsolationEvent = {
      schema: 2, id: run.events.length + 1, runId: run.id, at: new Date().toISOString(), type,
      sessionId: null, threadId: null, turnId: null, toolCallId: null,
      checkpointId: run.checkpointId, processId: run.processId, command: null,
      cwd: null, risk: null, approvalSource: "isolated-policy", durationMs: null,
      exitStatus: null, outputBytes: null, finalDiffHash: null, message, ...fields,
    };
    const clean = redactValue(event); run.events.push(clean); run.updatedAt = event.at;
    const dir = join(this.#config.dataDir, "isolation", run.id); await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "events.jsonl"), `${JSON.stringify(clean)}\n`, "utf8");
    await writeFile(join(dir, "run.json"), `${JSON.stringify(redactValue({ ...run, events: [] }), null, 2)}\n`, "utf8");
    for (const listener of this.#listeners.get(run.id) ?? []) listener(clean);
  }

  async start(task: string, sourceCwd: string): Promise<IsolationRun> {
    if (!task.trim()) throw new Error("task_required");
    if (!existsSync(this.#config.runnerCredentialPath)) {
      throw new Error("Isolated mode is not configured. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\install.ps1 -Full`, approve UAC, then retry.");
    }
    if (!existsSync(join(this.#config.dataDir, "runner-codex-home", "auth.json"))) {
      throw new Error("Runner Codex authentication is not configured. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\install.ps1 -ProvisionRunnerAuth`, then retry.");
    }
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const run: IsolationRun = { id, task: task.trim(), sourceCwd, status: "preparing", checkpointId: null, processId: null, createdAt: now, updatedAt: now, events: [] };
    this.#runs.set(id, run); await this.#emit(run, "isolation.created", "Isolated run created.", { cwd: sourceCwd, risk: "constrained" });
    try {
      const checkpoint = await this.checkpoints.prepare(sourceCwd, id); run.checkpointId = checkpoint.id;
      await this.#emit(run, "checkpoint.created", "Disposable Git worktree and baseline checkpoint created.", { checkpointId: checkpoint.id, cwd: checkpoint.workspaceCwd });
      void this.#execute(run, checkpoint);
      return this.get(id)!;
    } catch (error) {
      run.status = "failed"; run.error = error instanceof Error ? error.message : String(error);
      await this.#emit(run, "isolation.failed", "Isolated run preparation failed.", { data: { error: run.error } });
      throw error;
    }
  }

  async #execute(run: IsolationRun, checkpoint: CheckpointRecord): Promise<void> {
    const broker = this.#brokerFactory(); this.#brokers.set(run.id, broker); run.status = "running";
    await this.checkpoints.update(checkpoint.id, "running");
    const codex = this.#config.codexExecutable ?? resolveCodexExecutable();
    if (!codex) { run.status = "failed"; run.error = "codex_not_found"; await this.#emit(run, "isolation.failed", "Native Codex executable was not found."); return; }
    const args = buildIsolatedCodexArgs(checkpoint.workspaceCwd, run.task);
    try {
      const password = await readRunnerCredential(this.#config.runnerCredentialPath, checkpoint.workspace);
      await this.#emit(run, "process.started", "Restricted native Codex process starting.", { command: [codex, ...args], cwd: checkpoint.workspaceCwd });
      const result = await broker.launch({
        executable: codex, args, cwd: checkpoint.workspaceCwd, username: this.#config.runnerUsername, password,
        environment: this.#sanitizedEnvironment(checkpoint), timeoutMs: this.#config.isolatedTimeoutMs,
        outputDir: join(this.#config.dataDir, "isolation", run.id),
        onOutput: (stream, chunk) => { void this.#emit(run, "process.output", stream, { outputBytes: Buffer.byteLength(chunk), data: { stream, chunk } }); },
      });
      run.processId = result.pid; run.result = result;
      const diff = await this.checkpoints.diff(checkpoint.id);
      run.status = result.timedOut ? "interrupted" : result.exitCode === 0 ? "completed" : "failed";
      await this.checkpoints.update(checkpoint.id, run.status === "completed" ? "completed" : run.status === "interrupted" ? "interrupted" : "failed");
      await this.#emit(run, `isolation.${run.status}`, `Isolated process ${run.status}.`, { processId: result.pid, durationMs: result.durationMs, exitStatus: result.exitCode, finalDiffHash: diff.hash });
    } catch (error) {
      run.status = "failed"; run.error = error instanceof Error ? error.message : String(error);
      await this.checkpoints.update(checkpoint.id, "failed").catch(() => undefined);
      await this.#emit(run, "isolation.failed", "Restricted process failed.", { data: { error: run.error } });
    } finally { this.#brokers.delete(run.id); }
  }

  #sanitizedEnvironment(checkpoint: CheckpointRecord): Record<string, string> {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const runnerProfile = join(this.#config.dataDir, "runner-profile");
    const runnerCodexHome = join(this.#config.dataDir, "runner-codex-home");
    return {
      SystemRoot: systemRoot, WINDIR: systemRoot, ComSpec: join(systemRoot, "System32", "cmd.exe"),
      PATH: [join(systemRoot, "System32"), systemRoot, join(process.env.ProgramData ?? "C:\\ProgramData", "WinYOLO", "bin"), "C:\\Program Files\\dotnet", "C:\\Program Files\\Git\\cmd"].join(";"), PATHEXT: process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
      USERPROFILE: runnerProfile, LOCALAPPDATA: join(runnerProfile, "AppData", "Local"),
      APPDATA: join(runnerProfile, "AppData", "Roaming"), TEMP: join(this.#config.dataDir, "temp", checkpoint.runId),
      TMP: join(this.#config.dataDir, "temp", checkpoint.runId), CODEX_HOME: runnerCodexHome,
      WINYOLO_ISOLATION_RUN: checkpoint.runId,
    };
  }

  async interrupt(id: string): Promise<boolean> {
    const run = this.#runs.get(id); if (!run || run.status !== "running") return false;
    const stopped = this.#brokers.get(id)?.interrupt() ?? false;
    if (stopped) { run.status = "interrupted"; await this.#emit(run, "isolation.interrupted", "Job Object terminated the isolated process tree."); }
    return stopped;
  }
  async accept(id: string): Promise<IsolationRun> {
    const run = this.#runs.get(id); if (!run?.checkpointId) throw new Error("isolation_run_not_found");
    const record = await this.checkpoints.accept(run.checkpointId); run.status = "accepted";
    await this.#emit(run, "checkpoint.accepted", "Checkpoint patch applied to the source repository.", { finalDiffHash: record.finalDiffHash }); return this.get(id)!;
  }
  async rollback(id: string): Promise<IsolationRun> {
    const run = this.#runs.get(id); if (!run?.checkpointId) throw new Error("isolation_run_not_found");
    const record = await this.checkpoints.rollback(run.checkpointId); run.status = "rolled_back";
    await this.#emit(run, "checkpoint.rolled_back", "Checkpoint patch exported and disposable worktree removed.", { finalDiffHash: record.finalDiffHash }); return this.get(id)!;
  }
  async eventsFromDisk(id: string): Promise<IsolationEvent[]> {
    const content = await readFile(join(this.#config.dataDir, "isolation", id, "events.jsonl"), "utf8").catch(() => "");
    return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
}
