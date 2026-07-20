import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.ts";
import { ToolAuthority } from "./executor.ts";
import { OpenAIResponsesProvider } from "./providers/openai.ts";
import { CodexCliProvider } from "./providers/codex-cli.ts";
import { redactValue } from "./redact.ts";
import { TOOL_DEFINITIONS, WINYOLO_INSTRUCTIONS } from "./tools.ts";
import type { ApprovalRequest, ProviderName, RunEvent, ToolCall, ToolResult } from "./types.ts";

export interface AgentCallbacks {
  emit: (type: RunEvent["type"], message: string, data?: Record<string, unknown>) => Promise<void>;
  requestApproval: (approval: ApprovalRequest) => Promise<boolean>;
}

export interface AgentRunOptions {
  runId: string;
  task: string;
  cwd: string;
  provider: ProviderName;
}

export class WinYoloAgent {
  readonly #config: AppConfig;
  readonly #authority: ToolAuthority;
  readonly #openaiFactory: () => OpenAIResponsesProvider;

  constructor(
    config: AppConfig,
    authority = new ToolAuthority(config),
    openaiFactory = () => new OpenAIResponsesProvider(config),
  ) {
    this.#config = config;
    this.#authority = authority;
    this.#openaiFactory = openaiFactory;
  }

  async #execute(call: ToolCall, options: AgentRunOptions, cb: AgentCallbacks): Promise<ToolResult> {
    const assessment = this.#authority.assess(call, options.cwd);
    await cb.emit("tool.proposed", `${call.name}: ${assessment.reasons.join(" ")}`, {
      call: redactValue(call),
      assessment,
    });
    let confirmed = false;
    if (assessment.decision === "confirm") {
      const approval: ApprovalRequest = {
        id: randomUUID(),
        runId: options.runId,
        call,
        assessment,
        createdAt: new Date().toISOString(),
      };
      confirmed = await cb.requestApproval(approval);
      await cb.emit(
        confirmed ? "approval.accepted" : "approval.rejected",
        confirmed ? "Local confirmation accepted." : "Local confirmation rejected.",
        { approvalId: approval.id, fingerprint: assessment.fingerprint },
      );
      if (!confirmed) {
        return { ok: false, tool: call.name, error: "user_rejected", assessment };
      }
    }
    await cb.emit("tool.started", `Executing ${call.name}.`, { callId: call.callId });
    const result = await this.#authority.execute(call, options.cwd, confirmed);
    await cb.emit(result.ok ? "tool.completed" : "tool.failed", result.ok ? `${call.name} completed.` : `${call.name} failed.`, {
      callId: call.callId,
      result: redactValue(result),
    });
    return result;
  }

  async run(options: AgentRunOptions, cb: AgentCallbacks): Promise<string> {
    if (options.provider === "codex") return this.#runCodex(options, cb);
    return this.#runOpenAI(options, cb);
  }

  async #runOpenAI(options: AgentRunOptions, cb: AgentCallbacks): Promise<string> {
    const provider = this.#openaiFactory();
    const input: unknown[] = [{ role: "user", content: options.task }];
    let toolSteps = 0;
    while (toolSteps < this.#config.maxSteps) {
      await cb.emit("model.request", `Requesting ${this.#config.model}.`, { provider: "openai", toolSteps });
      const response = await provider.create(input, TOOL_DEFINITIONS, WINYOLO_INSTRUCTIONS);
      await cb.emit("model.response", "Model response received.", { responseId: response.id });
      input.push(...provider.outputItems(response));
      const calls = provider.toolCalls(response);
      if (!calls.length) {
        const answer = provider.text(response);
        if (!answer) throw new Error("Model returned neither a tool call nor final text.");
        return answer;
      }
      for (const call of calls) {
        toolSteps += 1;
        if (toolSteps > this.#config.maxSteps) break;
        const result = await this.#execute(call, options, cb);
        input.push({
          type: "function_call_output",
          call_id: call.callId,
          output: JSON.stringify(redactValue(result)),
        });
      }
    }
    throw new Error(`Run exceeded the ${this.#config.maxSteps}-tool step limit.`);
  }

  async #runCodex(options: AgentRunOptions, cb: AgentCallbacks): Promise<string> {
    const provider = new CodexCliProvider(options.cwd);
    const history: unknown[] = [];
    for (let step = 1; step <= this.#config.maxSteps; step += 1) {
      await cb.emit("model.request", "Requesting a structured Codex CLI decision.", { provider: "codex", step });
      const decision = await provider.decide(options.task, history);
      await cb.emit("model.response", "Codex CLI decision received.", { kind: decision.kind });
      if (decision.kind === "final") return decision.answer;
      const call = provider.toToolCall(decision, step);
      const result = await this.#execute(call, options, cb);
      history.push({ decision: redactValue(decision), result: redactValue(result) });
    }
    throw new Error(`Run exceeded the ${this.#config.maxSteps}-tool step limit.`);
  }
}
