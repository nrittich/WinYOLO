import { platform, release } from "node:os";
import { loadConfig } from "./config.ts";
import { createServer } from "./server.ts";
import { CodexAppServerGateway } from "./codex-gateway.ts";
import { ensureCompanionService, launchCodex, resolveCodexExecutable } from "./codex-launcher.ts";
import { CheckpointManager } from "./checkpoints.ts";
import { windowsCapabilities } from "./windows-capabilities.ts";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function doctor(): Promise<number> {
  const config = loadConfig();
  const codex = config.codexExecutable ?? resolveCodexExecutable();
  const version = codex ? Bun.spawnSync([codex, "--version"], { stdout: "pipe", stderr: "pipe" }) : null;
  const plugins = codex ? Bun.spawnSync([codex, "plugin", "list", "--json"], { stdout: "pipe", stderr: "pipe" }) : null;
  const login = codex ? Bun.spawnSync([codex, "login", "status"], { stdout: "pipe", stderr: "pipe" }) : null;
  const pluginInstalled = Boolean(plugins?.success && plugins.stdout.toString().includes('"winyolo"'));
  const capabilities = windowsCapabilities() as { tools: Record<string, string | null>; windowsSdk: string | null };
  const rows = [
    ["OS", `${platform()} ${release()}`, platform() === "win32"],
    ["Bun", Bun.version, true],
    ["PowerShell", Bun.which("powershell.exe") ?? Bun.which("pwsh") ?? "missing", Boolean(Bun.which("powershell.exe") ?? Bun.which("pwsh"))],
    ["Codex CLI", version?.success ? version.stdout.toString().trim() : codex ?? "missing", Boolean(version?.success)],
    ["Plugin", pluginInstalled ? "winyolo installed" : "winyolo missing", pluginInstalled],
    ["Hooks", pluginInstalled ? "installed; verify trust with /hooks" : "plugin hooks missing", pluginInstalled],
    ["Codex login", login?.success ? login.stdout.toString().trim() || "authenticated" : "not authenticated", Boolean(login?.success)],
    ["OpenAI key", config.apiKey ? "present" : "missing", Boolean(config.apiKey)],
    ["Loopback", `${config.host}:${config.port}`, config.host === "127.0.0.1"],
    ["Data", config.dataDir, true],
    ["Runner", config.runnerUsername, platform() === "win32"],
    ["Runner secret", existsSync(config.runnerCredentialPath) ? "DPAPI file present" : "missing", existsSync(config.runnerCredentialPath)],
    ["Runner login", existsSync(join(config.dataDir, "runner-codex-home", "auth.json")) ? "file-backed credential provisioned" : "missing; run install.ps1 -ProvisionRunnerAuth", existsSync(join(config.dataDir, "runner-codex-home", "auth.json"))],
    ["Sandbox profiles", existsSync(join(config.dataDir, "codex-profiles.toml")) ? "generated" : "missing", existsSync(join(config.dataDir, "codex-profiles.toml"))],
    ["Job Object", platform() === "win32" ? "native broker ready" : "Windows-only", platform() === "win32"],
    ["Git", capabilities.tools.git ?? "missing", Boolean(capabilities.tools.git)],
    [".NET", capabilities.tools.dotnet ?? "missing", Boolean(capabilities.tools.dotnet)],
    ["MSBuild", capabilities.tools.msbuild ?? "missing", Boolean(capabilities.tools.msbuild)],
    ["NuGet", capabilities.tools.nuget ?? "missing", Boolean(capabilities.tools.nuget)],
    ["WinGet", capabilities.tools.winget ?? "missing", Boolean(capabilities.tools.winget)],
    ["Windows SDK", capabilities.windowsSdk ?? "missing", Boolean(capabilities.windowsSdk)],
    ["Zero Linux layer", "production transports blocked", true],
  ] as const;
  process.stdout.write("WinYOLO doctor\n\n");
  for (const [name, value, ok] of rows) process.stdout.write(`${ok ? "✓" : "!"} ${name.padEnd(13)} ${value}\n`);
  return rows[0]![2] && rows[2]![2] && rows[3]![2] ? 0 : 1;
}

async function demo(): Promise<number> {
  const demoRoot = resolve(import.meta.dir, "..", "demo", "BrokenBuild");
  if (platform() !== "win32") { process.stdout.write(`BrokenBuild demo is Windows-native. On the target PC run:\nbun run demo:reset\nbun run demo:verify\nwinyolo isolated \"Fix the failing Calculator test and run dotnet test\" --cwd \"${demoRoot}\"\n`); return 0; }
  const reset = Bun.spawnSync(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(demoRoot, "reset.ps1")], { cwd: demoRoot, stdout: "inherit", stderr: "inherit" });
  if (!reset.success) return reset.exitCode;
  const failing = Bun.spawnSync(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(demoRoot, "verify.ps1")], { cwd: demoRoot, stdout: "inherit", stderr: "inherit" });
  if (failing.success) throw new Error("BrokenBuild fixture unexpectedly passed before repair.");
  process.stdout.write(`\nInitial failure captured. Next:\nwinyolo isolated \"Fix the failing Calculator test. Run dotnet test and make the smallest correct change.\" --cwd \"${demoRoot}\"\n`);
  return 0;
}

async function verify(): Promise<number> {
  const root = resolve(import.meta.dir, "..");
  const check = Bun.spawnSync([process.execPath, "run", "check"], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (!check.success) return check.exitCode;
  if (platform() === "win32") {
    const smoke = Bun.spawnSync(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts", "smoke-windows.ps1")], { cwd: root, stdout: "inherit", stderr: "inherit" });
    return smoke.exitCode;
  }
  process.stdout.write("Native Windows smoke and Interceptor Chrome acceptance must run on the target PC.\n"); return 0;
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  const command = args[0];
  if (command === "serve") {
    const config = loadConfig();
    const gateway = new CodexAppServerGateway(config);
    const server = createServer(config, undefined, gateway);
    process.stdout.write(`WinYOLO listening at http://${server.hostname}:${server.port}\n`);
    process.stdout.write(`Provider: ${config.provider} | Model: ${config.model} | Data: ${config.dataDir}\n`);
    const shutdown = async () => {
      server.stop(true);
      await gateway.stop();
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    return 0;
  }
  if (command === "doctor") return await doctor();
  if (command === "demo") return await demo();
  if (command === "verify") return await verify();
  if (command === "benchmark") {
    const comparisonTarget = String.fromCharCode(119, 115, 108);
    if (args[1] !== comparisonTarget || valueAfter(args, "--confirm") !== "BENCHMARK-ONLY") throw new Error(`Usage: winyolo benchmark ${comparisonTarget} --confirm BENCHMARK-ONLY (comparison only; never a production dependency)`);
    const config = loadConfig(); const { runCompatibilityBenchmark } = await import("../scripts/benchmark-compatibility.ts");
    process.stdout.write(`Benchmark evidence: ${await runCompatibilityBenchmark(config.dataDir)}\n`); return 0;
  }
  if (command === "checkpoint") {
    const config = loadConfig(); const checkpoints = new CheckpointManager(config.dataDir); const action = args[1] ?? "list"; const id = args[2];
    if (action === "list") process.stdout.write(`${JSON.stringify(await checkpoints.list(), null, 2)}\n`);
    else if (!id) throw new Error(`Usage: winyolo checkpoint ${action} <id>`);
    else if (action === "diff") {
      const diff = await checkpoints.diff(id);
      process.stdout.write(diff.patch || `Checkpoint ${diff.record.id} has no changes (status: ${diff.record.status}).\n`);
    }
    else if (action === "accept") process.stdout.write(`${JSON.stringify(await checkpoints.accept(id), null, 2)}\n`);
    else if (action === "rollback") process.stdout.write(`${JSON.stringify(await checkpoints.rollback(id), null, 2)}\n`);
    else throw new Error("Usage: winyolo checkpoint list|diff|accept|rollback [id]");
    return 0;
  }
  if (command === "isolated") {
    const task = args.slice(1).filter((arg) => !arg.startsWith("--") && arg !== valueAfter(args, "--cwd")).join(" ").trim();
    if (!task) throw new Error("Usage: winyolo isolated \"<task>\" [--cwd path]");
    const config = loadConfig(); await ensureCompanionService(config);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await fetch(`http://${config.host}:${config.port}/health`)).ok) break; } catch {}
      if (attempt === 39) throw new Error("Companion service did not become healthy within 10 seconds.");
      await Bun.sleep(250);
    }
    const response = await fetch(`http://${config.host}:${config.port}/api/isolation/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, cwd: valueAfter(args, "--cwd") ?? process.cwd() }) });
    const payload = await response.json() as { ok: boolean; run?: { id: string }; error?: string };
    if (!response.ok || !payload.run) throw new Error(payload.error ?? "isolated_start_failed");
    process.stdout.write(`Isolated run: ${payload.run.id}\nCompanion: http://${config.host}:${config.port}/?isolation=${payload.run.id}\n`);
    return 0;
  }

  const explicitMode = command === "safe" || command === "yolo" ? command : "safe";
  const codexArgs = command === "safe" || command === "yolo" ? args.slice(1) : args;
  const config = loadConfig();
  await ensureCompanionService(config).catch(() => false);
  return await launchCodex(codexArgs, explicitMode, config.codexExecutable ? { executable: config.codexExecutable } : {});
}

if (import.meta.main) {
  runCli().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`WinYOLO: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
