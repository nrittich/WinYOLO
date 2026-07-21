import { resolve } from "node:path";
import type { AppConfig } from "./config.ts";

const APPROVAL_FLAGS = new Set(["--ask-for-approval", "-a"]);
const SANDBOX_FLAGS = new Set(["--sandbox", "-s"]);
const YOLO_FLAGS = new Set(["--dangerously-bypass-approvals-and-sandbox", "--yolo"]);
const NETWORK_CONFIG = "sandbox_workspace_write.network_access=false";

export interface CodexSpawnOptions {
  executable?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  spawn?: typeof Bun.spawn;
}

function hasFlag(args: string[], names: Set<string>): boolean {
  return args.some((arg) => names.has(arg) || [...names].some((name) => arg.startsWith(`${name}=`)));
}

function configValues(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if ((arg === "-c" || arg === "--config") && args[index + 1]) values.push(args[index + 1]!);
    else if (arg.startsWith("--config=")) values.push(arg.slice("--config=".length));
  }
  return values;
}

function hasApprovalOverride(args: string[]): boolean {
  return hasFlag(args, APPROVAL_FLAGS) || hasFlag(args, YOLO_FLAGS) ||
    configValues(args).some((value) => /^approval_policy\s*=/.test(value));
}

function hasSandboxOverride(args: string[]): boolean {
  return hasFlag(args, SANDBOX_FLAGS) || hasFlag(args, YOLO_FLAGS) ||
    configValues(args).some((value) => /^sandbox_mode\s*=/.test(value));
}

export function hasExplicitSafetyOverride(args: string[]): boolean {
  return hasApprovalOverride(args) || hasSandboxOverride(args);
}

export function assertSafeBoundary(args: string[]): void {
  if (hasFlag(args, YOLO_FLAGS)) {
    throw new Error("WinYOLO blocks unrestricted Codex flags. Run raw `codex` outside WinYOLO if you intentionally need full access.");
  }
  const unsafeConfig = configValues(args).find((value) =>
    /^\s*sandbox_mode\s*=\s*["']?danger-full-access["']?\s*$/i.test(value)
  );
  if (unsafeConfig) throw new Error("WinYOLO blocks sandbox_mode=danger-full-access.");
  const sandboxIndex = args.findIndex((arg) => SANDBOX_FLAGS.has(arg));
  const inlineSandbox = args.find((arg) => [...SANDBOX_FLAGS].some((flag) => arg.startsWith(`${flag}=`)));
  if ((sandboxIndex >= 0 && args[sandboxIndex + 1] === "danger-full-access") || /danger-full-access$/i.test(inlineSandbox ?? "")) {
    throw new Error("WinYOLO blocks the danger-full-access sandbox.");
  }
}

export function buildCodexArgs(args: string[], mode: "yolo" | "safe" = "safe"): string[] {
  assertSafeBoundary(args);

  const defaults: string[] = [];
  if (!hasSandboxOverride(args)) defaults.push("--sandbox", "workspace-write");
  if (!hasApprovalOverride(args)) defaults.push("--ask-for-approval", mode === "yolo" ? "never" : "on-request");
  if (!configValues(args).some((value) => /^\s*sandbox_workspace_write\.network_access\s*=/.test(value))) {
    defaults.push("--config", NETWORK_CONFIG);
  }
  return [...defaults, ...args];
}

export function resolveCodexExecutable(
  which: (name: string) => string | null = Bun.which,
  sharedExists: (path: string) => boolean = (path) => Bun.file(path).size > 0,
): string | null {
  const shared = process.env.ProgramData ? resolve(process.env.ProgramData, "WinYOLO", "bin", "codex.exe") : null;
  return (shared && sharedExists(shared) ? shared : null) ?? which("codex.exe") ?? which("codex");
}

export async function isCompanionHealthy(config: AppConfig, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`http://${config.host}:${config.port}/health`, {
      signal: AbortSignal.timeout(750),
    });
    return response.ok && (await response.json() as { status?: string }).status === "ok";
  } catch {
    return false;
  }
}

export async function ensureCompanionService(
  config: AppConfig,
  options: { fetcher?: typeof fetch; spawn?: typeof Bun.spawn; cliPath?: string } = {},
): Promise<boolean> {
  if (await isCompanionHealthy(config, options.fetcher ?? fetch)) return false;
  const child = (options.spawn ?? Bun.spawn)([
    process.execPath,
    "run",
    options.cliPath ?? resolve(import.meta.dir, "cli.ts"),
    "serve",
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  child.unref();
  return true;
}

export async function launchCodex(
  args: string[],
  mode: "yolo" | "safe",
  options: CodexSpawnOptions = {},
): Promise<number> {
  const executable = options.executable ?? resolveCodexExecutable();
  if (!executable) throw new Error("Codex CLI was not found on PATH. Install Codex and run `codex login` first.");
  const child = (options.spawn ?? Bun.spawn)([executable, ...buildCodexArgs(args, mode)], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}
