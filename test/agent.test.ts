import { describe, expect, test } from "bun:test";
import { WinYoloAgent } from "../src/agent.ts";
import { ToolAuthority } from "../src/executor.ts";
import { testConfig } from "./helpers.ts";

describe("agent loop", () => {
  test("preserves call IDs and stops at the configured tool-step limit", async () => {
    const config = testConfig({ maxSteps: 2 });
    const inputs: unknown[][] = [];
    let responseNumber = 0;
    const provider = {
      create: async (input: unknown[]) => {
        inputs.push(structuredClone(input));
        responseNumber += 1;
        return {
          id: `response-${responseNumber}`,
          output: [{
            type: "function_call",
            call_id: `call-${responseNumber}`,
            name: "win_filesystem",
            arguments: JSON.stringify({ action: "list", path: config.defaultCwd, content: null, destination: null, recursive: false }),
          }],
        };
      },
      outputItems: (response: any) => response.output,
      toolCalls: (response: any) => response.output.map((item: any) => ({
        callId: item.call_id,
        name: item.name,
        arguments: JSON.parse(item.arguments),
      })),
      text: () => "",
    } as any;
    const agent = new WinYoloAgent(config, new ToolAuthority(config), () => provider);

    await expect(agent.run(
      { runId: "limit-run", task: "keep listing", cwd: config.defaultCwd, provider: "openai" },
      { emit: async () => {}, requestApproval: async () => false },
    )).rejects.toThrow("2-tool step limit");

    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContainEqual(expect.objectContaining({
      type: "function_call_output",
      call_id: "call-1",
    }));
  });
});
