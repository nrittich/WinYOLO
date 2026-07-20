import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactText } from "../redact.ts";
import type { ToolCall, ToolName } from "../types.ts";
import { TOOL_DEFINITIONS, WINYOLO_INSTRUCTIONS } from "../tools.ts";

type CodexDecision =
  | { kind: "tool"; name: ToolName; arguments: Record<string, unknown>; rationale: string }
  | { kind: "final"; answer: string };

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["tool", "final"] },
    name: { type: ["string", "null"], enum: ["win_system_inspect", "win_shell", "win_filesystem", "win_process", null] },
    arguments: {
      type: ["string", "null"],
      description: "A serialized JSON object containing the exact tool arguments, or null for a final answer.",
    },
    rationale: { type: ["string", "null"] },
    answer: { type: ["string", "null"] },
  },
  required: ["kind", "name", "arguments", "rationale", "answer"],
  additionalProperties: false,
};

export class CodexCliProvider {
  readonly #cwd: string;

  constructor(cwd: string) {
    this.#cwd = cwd;
  }

  available(): boolean {
    return Boolean(Bun.which("codex") || Bun.which("codex.exe"));
  }

  async decide(task: string, history: unknown[]): Promise<CodexDecision> {
    const executable = Bun.which("codex") ?? Bun.which("codex.exe");
    if (!executable) throw new Error("Codex CLI is not installed or not on PATH.");
    const scratch = await mkdtemp(join(tmpdir(), "winyolo-codex-"));
    const schemaPath = join(scratch, "decision.schema.json");
    const outputPath = join(scratch, "decision.json");
    await writeFile(schemaPath, JSON.stringify(DECISION_SCHEMA), "utf8");
    const prompt = `${WINYOLO_INSTRUCTIONS}\n\nYou are acting only as a planner. Do not execute commands yourself. Return exactly one structured decision. For a tool decision, put its arguments in the arguments field as a serialized JSON object string. For a final answer, set arguments to null. Tool schemas:\n${JSON.stringify(TOOL_DEFINITIONS)}\n\nUSER TASK:\n${task}\n\nPRIOR TOOL HISTORY:\n${JSON.stringify(history)}`;
    try {
      const proc = Bun.spawn([
        executable,
        "exec",
        "--sandbox",
        "read-only",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-C",
        this.#cwd,
        "-",
      ], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: process.env });
      proc.stdin.write(prompt);
      proc.stdin.end();
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0) throw new Error(redactText(stderr || stdout || `Codex exited ${code}.`));
      const raw = await readFile(outputPath, "utf8");
      const parsed = JSON.parse(raw) as {
        kind: "tool" | "final";
        name: ToolName | null;
        arguments: string | null;
        rationale: string | null;
        answer: string | null;
      };
      if (parsed.kind === "final") return { kind: "final", answer: parsed.answer ?? "Completed." };
      if (!parsed.name || !parsed.arguments) throw new Error("Codex returned an incomplete tool decision.");
      const toolArguments = JSON.parse(parsed.arguments) as unknown;
      if (!toolArguments || typeof toolArguments !== "object" || Array.isArray(toolArguments)) {
        throw new Error("Codex returned invalid serialized tool arguments.");
      }
      return {
        kind: "tool",
        name: parsed.name,
        arguments: toolArguments as Record<string, unknown>,
        rationale: parsed.rationale ?? "Codex proposed a native action.",
      };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  toToolCall(decision: Extract<CodexDecision, { kind: "tool" }>, step: number): ToolCall {
    return { callId: `codex-${step}`, name: decision.name, arguments: decision.arguments };
  }
}
