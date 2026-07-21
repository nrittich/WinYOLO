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
  codexExecutable?: string;
  codexRequestTimeoutMs: number;
  codexRestartLimit: number;
  codexEventBufferSize: number;
  runnerUsername: string;
  runnerCredentialPath: string;
  isolatedTimeoutMs: number;
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
  const codexExecutable = env.WINYOLO_CODEX_PATH?.trim();
  const dataDir = defaultDataDir(env);
  return {
    host: env.WINYOLO_HOST?.trim() || "127.0.0.1",
    port: positiveInt(env.WINYOLO_PORT, 4747),
    provider,
    model: env.WINYOLO_MODEL?.trim() || "gpt-5.6",
    ...(apiKey ? { apiKey } : {}),
    maxSteps: positiveInt(env.WINYOLO_MAX_STEPS, 20),
    commandTimeoutMs: positiveInt(env.WINYOLO_COMMAND_TIMEOUT_MS, 120_000),
    maxOutputBytes: positiveInt(env.WINYOLO_MAX_OUTPUT_BYTES, 200_000),
    dataDir,
    defaultCwd: resolve(env.WINYOLO_CWD?.trim() || cwd),
    ...(codexExecutable ? { codexExecutable } : {}),
    codexRequestTimeoutMs: positiveInt(env.WINYOLO_CODEX_REQUEST_TIMEOUT_MS, 30_000),
    codexRestartLimit: positiveInt(env.WINYOLO_CODEX_RESTART_LIMIT, 2),
    codexEventBufferSize: positiveInt(env.WINYOLO_CODEX_EVENT_BUFFER_SIZE, 500),
    runnerUsername: env.WINYOLO_RUNNER_USERNAME?.trim() || "WinYOLORunner",
    runnerCredentialPath: resolve(env.WINYOLO_RUNNER_CREDENTIAL_PATH?.trim() || join(dataDir, "protected", "runner.dpapi")),
    isolatedTimeoutMs: positiveInt(env.WINYOLO_ISOLATED_TIMEOUT_MS, 30 * 60_000),
  };
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
