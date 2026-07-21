import type { AppConfig } from "./config.ts";
import { redactText, redactValue } from "./redact.ts";
import { resolveCodexExecutable } from "./codex-launcher.ts";

export type JsonObject = Record<string, unknown>;

export interface RpcMessage {
  id?: string | number;
  method?: string;
  params?: JsonObject;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface GatewayEvent {
  id: number;
  type: string;
  at: string;
  data: unknown;
  threadId?: string;
}

export interface GatewayDiagnostics {
  available: boolean;
  initialized: boolean;
  codexVersion: string | null;
  restarts: number;
  pendingRequests: number;
  pendingApprovals: number;
  malformedMessages: number;
  lastError: string | null;
}

export interface AppServerProcess {
  stdin: { write(data: string): number | Promise<number>; flush?: () => void | Promise<void>; end?: () => void };
  stdout: ReadableStream<Uint8Array>;
  stderr?: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
}

export type AppServerSpawn = (executable: string) => AppServerProcess;
type EventListener = (event: GatewayEvent) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CodexGatewayError extends Error {
  constructor(message: string, readonly code = -32000) {
    super(redactText(message).slice(0, 500));
  }
}

function defaultSpawn(executable: string): AppServerProcess {
  return Bun.spawn([executable, "app-server", "--listen", "stdio://"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
    windowsHide: true,
  }) as unknown as AppServerProcess;
}

function threadIdFrom(message: RpcMessage): string | undefined {
  const value = message.params?.threadId ?? (message.params?.thread as JsonObject | undefined)?.id;
  return typeof value === "string" ? value : undefined;
}

async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) onLine(line);
        newline = buffered.indexOf("\n");
      }
    }
    const tail = (buffered + decoder.decode()).trim();
    if (tail) onLine(tail);
  } finally {
    reader.releaseLock();
  }
}

export class CodexAppServerGateway {
  private process: AppServerProcess | null = null;
  private startPromise: Promise<void> | null = null;
  private stopping = false;
  private initialized = false;
  private nextRequestId = 1;
  private nextEventId = 1;
  private restarts = 0;
  private malformedMessages = 0;
  private lastError: string | null = null;
  private codexVersion: string | null = null;
  private pending = new Map<string | number, PendingRequest>();
  private serverRequests = new Map<string | number, RpcMessage>();
  private events: GatewayEvent[] = [];
  private listeners = new Set<EventListener>();

  constructor(
    private readonly config: AppConfig,
    private readonly spawn: AppServerSpawn = defaultSpawn,
    private readonly which: (name: string) => string | null = Bun.which,
  ) {}

  diagnostics(): GatewayDiagnostics {
    return {
      available: Boolean(this.config.codexExecutable ?? resolveCodexExecutable(this.which)),
      initialized: this.initialized,
      codexVersion: this.codexVersion,
      restarts: this.restarts,
      pendingRequests: this.pending.size,
      pendingApprovals: this.serverRequests.size,
      malformedMessages: this.malformedMessages,
      lastError: this.lastError,
    };
  }

  async start(): Promise<void> {
    if (this.initialized && this.process) return;
    if (this.startPromise) return this.startPromise;
    this.stopping = false;
    this.startPromise = this.launch();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async launch(): Promise<void> {
    const executable = this.config.codexExecutable ?? resolveCodexExecutable(this.which);
    if (!executable) throw new CodexGatewayError("Codex CLI is unavailable.", -32010);
    const process_ = this.spawn(executable);
    this.process = process_;
    void readLines(process_.stdout, (line) => this.handleLine(line));
    if (process_.stderr) void readLines(process_.stderr, (line) => {
      this.lastError = redactText(line).slice(0, 500);
      this.emit("gateway/stderr", { message: this.lastError });
    });
    void process_.exited.then((code) => this.handleExit(process_, code));
    const initialized = await this.rawRequest("initialize", {
      clientInfo: { name: "winyolo", title: "WinYOLO", version: "0.2.0" },
      capabilities: { experimentalApi: true },
    }) as JsonObject;
    this.codexVersion = typeof initialized.userAgent === "string" ? initialized.userAgent : null;
    await this.write({ method: "initialized" });
    this.initialized = true;
    this.emit("gateway/ready", { codexVersion: this.codexVersion });
  }

  private handleLine(line: string): void {
    let message: RpcMessage;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not_object");
      message = parsed as RpcMessage;
    } catch {
      this.malformedMessages += 1;
      this.lastError = "Malformed app-server message.";
      this.emit("gateway/malformed", { message: this.lastError });
      return;
    }

    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.emit("gateway/orphanResponse", { id: message.id });
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new CodexGatewayError(message.error.message ?? "Codex request failed.", message.error.code));
      else pending.resolve(redactValue(message.result));
      return;
    }

    if (message.id !== undefined && message.method) {
      this.serverRequests.set(message.id, redactValue(message));
      this.emit("serverRequest", message, threadIdFrom(message));
      return;
    }

    if (message.method) this.emit(message.method, message.params ?? {}, threadIdFrom(message));
    else {
      this.malformedMessages += 1;
      this.emit("gateway/malformed", { message: "App-server message lacked method and response id." });
    }
  }

  private handleExit(process_: AppServerProcess, code: number): void {
    if (this.process !== process_) return;
    this.process = null;
    this.initialized = false;
    this.startPromise = null;
    const error = new CodexGatewayError(`Codex app-server exited with code ${code}.`, -32011);
    this.lastError = error.message;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.serverRequests.clear();
    this.emit("gateway/exited", { code });
    if (!this.stopping && this.restarts < this.config.codexRestartLimit) {
      this.restarts += 1;
      this.emit("gateway/restarting", { attempt: this.restarts });
      setTimeout(() => void this.start().catch((cause) => {
        this.lastError = cause instanceof Error ? redactText(cause.message) : "Gateway restart failed.";
      }), Math.min(250 * (2 ** (this.restarts - 1)), 2_000));
    }
  }

  private async write(message: RpcMessage): Promise<void> {
    if (!this.process) throw new CodexGatewayError("Codex app-server is unavailable.", -32010);
    await this.process.stdin.write(`${JSON.stringify(message)}\n`);
    await this.process.stdin.flush?.();
  }

  private rawRequest(method: string, params: JsonObject): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexGatewayError(`Codex request '${method}' timed out.`, -32012));
      }, this.config.codexRequestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      void this.write({ id, method, params }).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async request<T = unknown>(method: string, params: JsonObject = {}): Promise<T> {
    await this.start();
    return await this.rawRequest(method, params) as T;
  }

  private emit(type: string, data: unknown, threadId?: string): void {
    const event: GatewayEvent = {
      id: this.nextEventId++,
      type,
      at: new Date().toISOString(),
      data: redactValue(data),
      ...(threadId ? { threadId } : {}),
    };
    this.events.push(event);
    if (this.events.length > this.config.codexEventBufferSize) this.events.shift();
    for (const listener of this.listeners) listener(event);
  }

  subscribe(after: number, listener: EventListener): { replay: GatewayEvent[]; reset: boolean; unsubscribe: () => void } {
    this.listeners.add(listener);
    const oldest = this.events[0]?.id ?? this.nextEventId;
    const reset = after > 0 && (after < oldest - 1 || after >= this.nextEventId);
    return {
      replay: reset ? [] : this.events.filter((event) => event.id > after),
      reset,
      unsubscribe: () => this.listeners.delete(listener),
    };
  }

  pendingServerRequests(): RpcMessage[] {
    return [...this.serverRequests.values()].map((value) => structuredClone(value));
  }

  async respondToServerRequest(id: string | number, input: JsonObject): Promise<void> {
    await this.start();
    const resolvedId = this.serverRequests.has(id) ? id :
      (typeof id === "string" && /^\d+$/.test(id) && this.serverRequests.has(Number(id)) ? Number(id) : id);
    const request = this.serverRequests.get(resolvedId);
    if (!request?.method) throw new CodexGatewayError("Approval request was not found.", -32020);
    const choice = input.decision === "approve" ? "accept" : input.decision === "cancel" ? "cancel" : "decline";
    let result: JsonObject;
    if (request.method === "item/commandExecution/requestApproval" || request.method === "item/fileChange/requestApproval") {
      const available = request.params?.availableDecisions;
      if (Array.isArray(available) && !available.includes(choice)) throw new CodexGatewayError("That approval decision is unavailable.", -32602);
      result = { decision: choice };
    } else if (request.method === "item/permissions/requestApproval") {
      const requested = request.params?.permissions as JsonObject | undefined;
      const permissions = choice === "accept" && requested
        ? Object.fromEntries(Object.entries(requested).filter(([, value]) => value !== null))
        : {};
      result = { permissions, scope: input.scope === "session" ? "session" : "turn" };
    } else if (request.method === "item/tool/requestUserInput") {
      if (!input.answers || typeof input.answers !== "object") throw new CodexGatewayError("Answers are required.", -32602);
      result = { answers: input.answers };
    } else if (request.method === "mcpServer/elicitation/request") {
      result = { action: choice, content: choice === "accept" ? (input.content ?? null) : null, _meta: null };
    } else {
      if (choice === "accept") throw new CodexGatewayError("This server request cannot be approved by WinYOLO.", -32601);
      await this.write({ id: resolvedId, error: { code: -32000, message: "Rejected by WinYOLO operator." } });
      this.serverRequests.delete(resolvedId);
      this.emit("serverRequest/resolvedByClient", { id: resolvedId, method: request.method, decision: choice }, threadIdFrom(request));
      return;
    }
    await this.write({ id: resolvedId, result });
    this.serverRequests.delete(resolvedId);
    this.emit("serverRequest/resolvedByClient", { id: resolvedId, method: request.method, decision: choice }, threadIdFrom(request));
  }

  listThreads(params: JsonObject): Promise<JsonObject> {
    return this.request("thread/list", params);
  }

  searchThreads(params: JsonObject): Promise<JsonObject> {
    return this.request("thread/search", params);
  }

  readThread(threadId: string): Promise<JsonObject> {
    return this.request("thread/read", { threadId, includeTurns: true });
  }

  archiveThread(threadId: string): Promise<JsonObject> {
    return this.request("thread/archive", { threadId });
  }

  unarchiveThread(threadId: string): Promise<JsonObject> {
    return this.request("thread/unarchive", { threadId });
  }

  startThread(cwd: string, mode: "safe" | "yolo"): Promise<JsonObject> {
    return this.request("thread/start", {
      cwd,
      approvalPolicy: mode === "safe" ? "on-request" : "never",
      sandbox: "workspace-write",
    });
  }

  resumeThread(threadId: string, cwd: string | undefined, mode: "safe" | "yolo"): Promise<JsonObject> {
    return this.request("thread/resume", {
      threadId,
      ...(cwd ? { cwd } : {}),
      approvalPolicy: mode === "safe" ? "on-request" : "never",
      sandbox: "workspace-write",
    });
  }

  startTurn(threadId: string, text: string, images: string[], mode: "safe" | "yolo"): Promise<JsonObject> {
    return this.request("turn/start", {
      threadId,
      input: [
        ...(text ? [{ type: "text", text, text_elements: [] }] : []),
        ...images.map((path) => ({ type: "localImage", path })),
      ],
      approvalPolicy: mode === "safe" ? "on-request" : "never",
      sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: false },
    });
  }

  interruptTurn(threadId: string, turnId: string): Promise<JsonObject> {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const error = new CodexGatewayError("Codex gateway stopped.", -32013);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.serverRequests.clear();
    this.initialized = false;
    const process_ = this.process;
    this.process = null;
    process_?.stdin.end?.();
    process_?.kill("SIGTERM");
  }
}
