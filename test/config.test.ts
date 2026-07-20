import { describe, expect, test } from "bun:test";
import { isLoopbackHost, loadConfig } from "../src/config.ts";

describe("configuration", () => {
  test("defaults to GPT-5.6, OpenAI, and loopback", () => {
    const config = loadConfig({}, "/tmp");
    expect(config.model).toBe("gpt-5.6");
    expect(config.provider).toBe("openai");
    expect(config.host).toBe("127.0.0.1");
  });

  test("only known loopback hosts pass", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });
});
