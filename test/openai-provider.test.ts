import { describe, expect, test } from "bun:test";
import { OpenAIResponsesProvider } from "../src/providers/openai.ts";
import { TOOL_DEFINITIONS } from "../src/tools.ts";
import { testConfig } from "./helpers.ts";

describe("OpenAI Responses provider", () => {
  test("sends GPT-5.6 strict tools and parses call IDs", async () => {
    let payload: any;
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body));
      return Response.json({
        id: "resp_test",
        output: [{ type: "function_call", call_id: "call_123", name: "win_system_inspect", arguments: "{\"area\":\"summary\"}" }],
      });
    }) as typeof fetch;
    const provider = new OpenAIResponsesProvider(testConfig(), fakeFetch);
    const response = await provider.create([{ role: "user", content: "inspect" }], TOOL_DEFINITIONS, "instructions");
    expect(payload.model).toBe("gpt-5.6");
    expect(payload.store).toBe(false);
    expect(payload.tools.every((tool: any) => tool.strict === true)).toBe(true);
    expect(provider.toolCalls(response)[0]).toEqual({ callId: "call_123", name: "win_system_inspect", arguments: { area: "summary" } });
  });

  test("parses final output text", () => {
    const provider = new OpenAIResponsesProvider(testConfig());
    expect(provider.text({ id: "x", output_text: "Finished." })).toBe("Finished.");
  });

  test("fails without an API key", async () => {
    const config = testConfig();
    delete config.apiKey;
    const provider = new OpenAIResponsesProvider(config);
    await expect(provider.create([], TOOL_DEFINITIONS, "x")).rejects.toThrow("OPENAI_API_KEY");
  });
});
