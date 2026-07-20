import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { platform } from "node:os";
import type { AppConfig } from "./config.ts";
import { assessToolCall } from "./policy.ts";
import { redactText } from "./redact.ts";
import type { PolicyAssessment, ToolCall, ToolResult } from "./types.ts";

interface BoundedRead {
  text: string;
  truncated: boolean;
}

async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<BoundedRead> {
  if (!stream) return { text: "", truncated: false };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let kept = 0;
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (kept < maxBytes) {
      const remaining = maxBytes - kept;
      const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(slice);
      kept += slice.byteLength;
    }
  }
  return {
    text: redactText(Buffer.concat(chunks).toString("utf8")),
    truncated: total > maxBytes,
  };
}

function powershellExecutable(): string | null {
  if (platform() === "win32") return Bun.which("powershell.exe") ?? "powershell.exe";
  return Bun.which("pwsh");
}

function shellCommand(shell: string, script: string): string[] | null {
  if (shell === "cmd") {
    if (platform() !== "win32") return null;
    return [Bun.which("cmd.exe") ?? "cmd.exe", "/d", "/s", "/c", script];
  }
  const executable = powershellExecutable();
  if (!executable) return null;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return [
    executable,
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encoded,
  ];
}

async function terminateTree(pid: number): Promise<void> {
  if (platform() === "win32") {
    const killer = Bun.spawn(["taskkill.exe", "/PID", String(pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await killer.exited;
  }
}

export async function runNativeShell(options: {
  shell: "powershell" | "cmd";
  script: string;
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
}): Promise<Omit<ToolResult, "tool" | "assessment">> {
  const command = shellCommand(options.shell, options.script);
  if (!command) {
    return { ok: false, error: `${options.shell} is unavailable on ${platform()}.` };
  }

  const started = Date.now();
  try {
    const proc = Bun.spawn(command, {
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: process.env,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateTree(proc.pid).finally(() => proc.kill());
    }, options.timeoutMs);
    const [stdout, stderr, exitCode] = await Promise.all([
      readBounded(proc.stdout, options.maxOutputBytes),
      readBounded(proc.stderr, options.maxOutputBytes),
      proc.exited,
    ]);
    clearTimeout(timer);
    return {
      ok: !timedOut && exitCode === 0,
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      timedOut,
      truncated: stdout.truncated || stderr.truncated,
      durationMs: Date.now() - started,
      ...(timedOut ? { error: `Command timed out after ${options.timeoutMs}ms.` } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      error: redactText(error instanceof Error ? error.message : String(error)),
      durationMs: Date.now() - started,
    };
  }
}

function inspectScript(area: string): string {
  const scripts: Record<string, string> = {
    summary:
      "$os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1; [pscustomobject]@{Computer=$env:COMPUTERNAME;User=$env:USERNAME;OS=$os.Caption;Version=$os.Version;Architecture=$os.OSArchitecture;CPU=$cpu.Name;Elevated=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)} | ConvertTo-Json -Compress",
    os: "Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,LastBootUpTime | ConvertTo-Json -Compress",
    hardware:
      "[pscustomobject]@{CPU=(Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name);MemoryGB=[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,2);GPU=(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name)} | ConvertTo-Json -Compress",
    network:
      "Get-NetIPConfiguration | Select-Object InterfaceAlias,@{N='IPv4';E={$_.IPv4Address.IPAddress}},@{N='Gateway';E={$_.IPv4DefaultGateway.NextHop}} | ConvertTo-Json -Compress",
    disks:
      "Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter,FileSystemLabel,FileSystem,@{N='SizeGB';E={[math]::Round($_.Size/1GB,2)}},@{N='FreeGB';E={[math]::Round($_.SizeRemaining/1GB,2)}} | ConvertTo-Json -Compress",
    devtools:
      "$names='git','bun','codex','node','python','dotnet','docker'; $names | ForEach-Object { $c=Get-Command $_ -ErrorAction SilentlyContinue; [pscustomobject]@{Name=$_;Found=[bool]$c;Path=$c.Source} } | ConvertTo-Json -Compress",
  };
  return scripts[area] ?? scripts.summary!;
}

export class ToolAuthority {
  readonly #config: AppConfig;

  constructor(config: AppConfig) {
    this.#config = config;
  }

  assess(call: ToolCall, cwd: string): PolicyAssessment {
    return assessToolCall(call, cwd);
  }

  async execute(call: ToolCall, cwd: string, confirmed = false): Promise<ToolResult> {
    const assessment = this.assess(call, cwd);
    if (assessment.decision === "block") {
      return { ok: false, tool: call.name, error: assessment.reasons.join(" "), assessment };
    }
    if (assessment.decision === "confirm" && !confirmed) {
      return { ok: false, tool: call.name, error: "approval_required", assessment };
    }

    const args = call.arguments;
    try {
      if (call.name === "win_system_inspect") {
        const result = await runNativeShell({
          shell: "powershell",
          script: inspectScript(String(args.area ?? "summary")),
          cwd,
          timeoutMs: this.#config.commandTimeoutMs,
          maxOutputBytes: this.#config.maxOutputBytes,
        });
        return { ...result, tool: call.name, assessment };
      }

      if (call.name === "win_shell") {
        const shell = args.shell === "cmd" ? "cmd" : "powershell";
        const toolCwd = resolve(String(args.cwd ?? cwd));
        const requested = Number(args.timeout_ms);
        const timeoutMs = Number.isFinite(requested) && requested > 0
          ? Math.min(requested, this.#config.commandTimeoutMs)
          : this.#config.commandTimeoutMs;
        const result = await runNativeShell({
          shell,
          script: String(args.script ?? ""),
          cwd: toolCwd,
          timeoutMs,
          maxOutputBytes: this.#config.maxOutputBytes,
        });
        return { ...result, tool: call.name, assessment };
      }

      if (call.name === "win_filesystem") {
        const action = String(args.action ?? "list");
        const path = resolve(String(args.path ?? cwd));
        let data: unknown;
        if (action === "list") {
          const entries = await readdir(path, { withFileTypes: true });
          data = entries.map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" }));
        } else if (action === "read") {
          const info = await stat(path);
          if (info.size > this.#config.maxOutputBytes) throw new Error(`File exceeds ${this.#config.maxOutputBytes} byte read limit.`);
          data = await readFile(path, "utf8");
        } else if (action === "write") {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, String(args.content ?? ""), "utf8");
          data = { path, bytes: Buffer.byteLength(String(args.content ?? "")) };
        } else if (action === "move") {
          const destination = resolve(String(args.destination ?? ""));
          await mkdir(dirname(destination), { recursive: true });
          await rename(path, destination);
          data = { from: path, to: destination };
        } else if (action === "delete") {
          await rm(path, { recursive: Boolean(args.recursive), force: false });
          data = { deleted: path };
        } else {
          throw new Error(`Unknown filesystem action '${action}'.`);
        }
        return { ok: true, tool: call.name, data, assessment };
      }

      if (call.name === "win_process") {
        const action = String(args.action ?? "list");
        const pid = args.pid == null ? null : Number(args.pid);
        const name = args.name == null ? null : String(args.name);
        let script: string;
        if (action === "list") script = "Get-Process | Sort-Object CPU -Descending | Select-Object -First 40 Id,ProcessName,CPU,WorkingSet | ConvertTo-Json -Compress";
        else if (action === "status" && pid) script = `Get-Process -Id ${pid} | Select-Object Id,ProcessName,CPU,WorkingSet | ConvertTo-Json -Compress`;
        else if (action === "status" && name) script = `Get-Process -Name '${name.replace(/'/g, "''")}' | Select-Object Id,ProcessName,CPU,WorkingSet | ConvertTo-Json -Compress`;
        else if (action === "stop" && pid) script = `Stop-Process -Id ${pid} -Force -PassThru | Select-Object Id,ProcessName | ConvertTo-Json -Compress`;
        else if (action === "stop" && name) script = `Stop-Process -Name '${name.replace(/'/g, "''")}' -Force -PassThru | Select-Object Id,ProcessName | ConvertTo-Json -Compress`;
        else if (action === "start") script = `Start-Process -FilePath '${String(args.command ?? "").replace(/'/g, "''")}' -PassThru | Select-Object Id,ProcessName | ConvertTo-Json -Compress`;
        else throw new Error(`Invalid process action '${action}' arguments.`);
        const result = await runNativeShell({
          shell: "powershell",
          script,
          cwd,
          timeoutMs: this.#config.commandTimeoutMs,
          maxOutputBytes: this.#config.maxOutputBytes,
        });
        return { ...result, tool: call.name, assessment };
      }
      throw new Error(`Unknown tool '${call.name}'.`);
    } catch (error) {
      return {
        ok: false,
        tool: call.name,
        error: redactText(error instanceof Error ? error.message : String(error)),
        assessment,
      };
    }
  }
}
