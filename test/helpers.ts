import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../src/config.ts";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = mkdtempSync(join(tmpdir(), "winyolo-test-"));
  return {
    host: "127.0.0.1",
    port: 0,
    provider: "openai",
    model: "gpt-5.6",
    apiKey: "sk-test-canary-not-a-real-key",
    maxSteps: 4,
    commandTimeoutMs: 2_000,
    maxOutputBytes: 4_096,
    dataDir,
    defaultCwd: dataDir,
    ...overrides,
  };
}
