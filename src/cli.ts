#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { platform, release } from "node:os";
import { loadConfig } from "./config.ts";
import { ToolAuthority } from "./executor.ts";
import { WinYoloAgent } from "./agent.ts";
import { createServer } from "./server.ts";
import type { ApprovalRequest, ProviderName, RunEvent, ToolCall } from "./types.ts";

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function askApproval(approval: ApprovalRequest): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const phrase = approval.assessment.confirmationPhrase!;
  process.stdout.write(`\nHIGH-RISK ACTION\n${approval.assessment.reasons.join("\n")}\n`);
  process.stdout.write(`Command: ${JSON.stringify(approval.call.arguments)}\nType '${phrase}' to continue: `);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question("")).trim() === phrase;
  } finally {
    rl.close();
  }
}

function printEvent(type: RunEvent["type"], message: string): void {
  const marker = type.includes("failed") ? "✗" : type.includes("approval") ? "!" : "•";
  process.stdout.write(`${marker} ${message}\n`);
}

async function runTask(task: string, provider: ProviderName): Promise<number> {
  const config = loadConfig({ ...process.env, WINYOLO_PROVIDER: provider });
  const agent = new WinYoloAgent(config);
  const answer = await agent.run(
    { runId: crypto.randomUUID(), task, cwd: valueAfter("--cwd") ?? config.defaultCwd, provider },
    {
      emit: async (type, message) => printEvent(type, message),
      requestApproval: askApproval,
    },
  );
  process.stdout.write(`\n${answer}\n`);
  return 0;
}

async function doctor(): Promise<number> {
  const config = loadConfig();
  const rows = [
    ["OS", `${platform()} ${release()}`, platform() === "win32"],
    ["Bun", Bun.version, true],
    ["PowerShell", Bun.which("powershell.exe") ?? Bun.which("pwsh") ?? "missing", Boolean(Bun.which("powershell.exe") ?? Bun.which("pwsh"))],
    ["Codex CLI", Bun.which("codex.exe") ?? Bun.which("codex") ?? "missing", Boolean(Bun.which("codex.exe") ?? Bun.which("codex"))],
    ["OpenAI key", config.apiKey ? "present" : "missing", Boolean(config.apiKey)],
    ["Loopback", `${config.host}:${config.port}`, config.host === "127.0.0.1"],
    ["Data", config.dataDir, true],
  ] as const;
  process.stdout.write("WinYOLO doctor\n\n");
  for (const [name, value, ok] of rows) process.stdout.write(`${ok ? "✓" : "!"} ${name.padEnd(13)} ${value}\n`);
  return rows[0]![2] && rows[2]![2] ? 0 : 1;
}

async function demo(): Promise<number> {
  const config = loadConfig();
  const authority = new ToolAuthority(config);
  const inspect: ToolCall = { callId: "demo-inspect", name: "win_system_inspect", arguments: { area: "summary" } };
  const risky: ToolCall = {
    callId: "demo-risk",
    name: "win_shell",
    arguments: { shell: "powershell", script: "Remove-Item 'C:\\Windows\\System32\\winyolo-demo-never-created' -Recurse -Force", cwd: null, timeout_ms: 30_000, reason: "Demonstrate protected-root confirmation without executing." },
  };
  process.stdout.write("WinYOLO native inspection\n");
  process.stdout.write(`${JSON.stringify(await authority.execute(inspect, config.defaultCwd), null, 2)}\n\n`);
  process.stdout.write("WinYOLO policy fixture (never executed)\n");
  process.stdout.write(`${JSON.stringify(authority.assess(risky, config.defaultCwd), null, 2)}\n`);
  return 0;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "serve";
  if (command === "serve") {
    const config = loadConfig();
    const server = createServer(config);
    process.stdout.write(`WinYOLO listening at http://${server.hostname}:${server.port}\n`);
    process.stdout.write(`Provider: ${config.provider} | Model: ${config.model} | Data: ${config.dataDir}\n`);
    return;
  }
  if (command === "doctor") process.exitCode = await doctor();
  else if (command === "demo") process.exitCode = await demo();
  else if (command === "run") {
    const task = process.argv.slice(3).filter((arg) => !arg.startsWith("--") && arg !== valueAfter("--provider") && arg !== valueAfter("--cwd")).join(" ").trim();
    if (!task) throw new Error("Usage: winyolo run <task> [--provider openai|codex] [--cwd path]");
    process.exitCode = await runTask(task, valueAfter("--provider") === "codex" ? "codex" : "openai");
  } else {
    process.stdout.write("Usage: winyolo <serve|run|doctor|demo>\n");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`WinYOLO: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
