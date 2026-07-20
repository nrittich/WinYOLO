import { describe, expect, test } from "bun:test";
import { redactText, redactValue } from "../src/redact.ts";

describe("redaction", () => {
  test("removes OpenAI-like keys and bearer tokens", () => {
    const value = redactText("OPENAI_API_KEY=sk-abcdefghijklmnopqrst Bearer abc.def.ghi");
    expect(value).not.toContain("sk-abcdefghijklmnopqrst");
    expect(value).not.toContain("abc.def.ghi");
  });

  test("redacts sensitive object fields recursively", () => {
    const value = redactValue({ nested: { authorization: "secret", safe: "ok" }, apiKey: "secret" });
    expect(value).toEqual({ nested: { authorization: "[REDACTED]", safe: "ok" }, apiKey: "[REDACTED]" });
  });
});
