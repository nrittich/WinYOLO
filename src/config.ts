import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import type { ProviderName } from "./types.ts";

export interface AppConfig {
  host: string;
  port: number;
  provider: ProviderName;
  model: string;
  apiKey?: string;
  maxSteps: number;
  commandTimeoutMs: number;
  maxOutputBytes: number;
  dataDir: string;
  defaultCwd: string;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function defaultDataDir(env: Record<string, string | undefined> = process.env): string {
  if (env.WINYOLO_DATA_DIR) return resolve(env.WINYOLO_DATA_DIR);
  if (platform() === "win32") {
    return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "WinYOLO");
  }
  return join(homedir(), ".winyolo");
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): AppConfig {
  const provider = env.WINYOLO_PROVIDER === "codex" ? "codex" : "openai";
  const apiKey = env.OPENAI_API_KEY?.trim();
  return {
    host: env.WINYOLO_HOST?.trim() || "127.0.0.1",
    port: positiveInt(env.WINYOLO_PORT, 4747),
    provider,
    model: env.WINYOLO_MODEL?.trim() || "gpt-5.6",
    ...(apiKey ? { apiKey } : {}),
    maxSteps: positiveInt(env.WINYOLO_MAX_STEPS, 20),
    commandTimeoutMs: positiveInt(env.WINYOLO_COMMAND_TIMEOUT_MS, 120_000),
    maxOutputBytes: positiveInt(env.WINYOLO_MAX_OUTPUT_BYTES, 200_000),
    dataDir: defaultDataDir(env),
    defaultCwd: resolve(env.WINYOLO_CWD?.trim() || cwd),
  };
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
