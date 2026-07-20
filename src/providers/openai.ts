import type { AppConfig } from "../config.ts";
import { redactText } from "../redact.ts";
import type { AgentToolDefinition, ToolCall, ToolName } from "../types.ts";

interface ResponseOutputItem {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
}

export interface OpenAIResponse {
  id: string;
  output?: ResponseOutputItem[];
  output_text?: string;
  error?: { message?: string };
}

const TOOL_NAMES = new Set<ToolName>([
  "win_system_inspect",
  "win_shell",
  "win_filesystem",
  "win_process",
]);

export class OpenAIResponsesProvider {
  readonly #config: AppConfig;
  readonly #fetch: typeof fetch;

  constructor(config: AppConfig, fetchImpl: typeof fetch = fetch) {
    this.#config = config;
    this.#fetch = fetchImpl;
  }

  async create(input: unknown[], tools: AgentToolDefinition[], instructions: string): Promise<OpenAIResponse> {
    if (!this.#config.apiKey) throw new Error("OPENAI_API_KEY is required for provider 'openai'.");
    const response = await this.#fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.#config.model,
        instructions,
        input,
        tools,
        parallel_tool_calls: false,
        reasoning: { effort: "medium" },
        store: false,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as OpenAIResponse;
    if (!response.ok) {
      throw new Error(redactText(body.error?.message || `OpenAI Responses API returned HTTP ${response.status}.`));
    }
    return body;
  }

  toolCalls(response: OpenAIResponse): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const item of response.output ?? []) {
      if (item.type !== "function_call") continue;
      if (!item.call_id || !item.name || !TOOL_NAMES.has(item.name as ToolName)) {
        throw new Error(`Model returned an unknown or malformed function call '${item.name ?? "unnamed"}'.`);
      }
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(item.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        throw new Error(`Model returned invalid JSON arguments for '${item.name}'.`);
      }
      calls.push({ callId: item.call_id, name: item.name as ToolName, arguments: args });
    }
    return calls;
  }

  outputItems(response: OpenAIResponse): ResponseOutputItem[] {
    return response.output ?? [];
  }

  text(response: OpenAIResponse): string {
    if (response.output_text) return response.output_text;
    const parts: string[] = [];
    for (const item of response.output ?? []) {
      for (const content of item.content ?? []) {
        if (content.type === "output_text" && content.text) parts.push(content.text);
      }
    }
    return parts.join("\n").trim();
  }
}
