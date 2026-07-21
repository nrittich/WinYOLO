import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { platform } from "node:os";
import { redactText } from "./redact.ts";

export interface BrokerLaunch {
  executable: string;
  args: string[];
  cwd: string;
  username: string;
  password: string;
  environment: Record<string, string>;
  timeoutMs: number;
  outputDir: string;
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
}

export interface BrokerResult {
  pid: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

function quoteWindowsArg(value: string): string {
  if (!/[\s"]/u.test(value)) return value;
  let result = '"';
  let slashes = 0;
  for (const character of value) {
    if (character === "\\") { slashes += 1; continue; }
    if (character === '"') result += "\\".repeat(slashes * 2 + 1) + '"';
    else result += "\\".repeat(slashes) + character;
    slashes = 0;
  }
  return result + "\\".repeat(slashes * 2) + '"';
}

function wide(value: string): Uint16Array {
  const buffer = new Uint16Array(value.length + 1);
  for (let index = 0; index < value.length; index += 1) buffer[index] = value.charCodeAt(index);
  return buffer;
}

function envBlock(environment: Record<string, string>): Uint16Array {
  const values = Object.entries(environment)
    .filter(([key]) => !/^(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_|AZURE_|GITHUB_TOKEN)/i.test(key))
    .sort(([left], [right]) => left.localeCompare(right, "en", { sensitivity: "base" }))
    .map(([key, value]) => `${key}=${value}`)
    .join("\0") + "\0\0";
  return wide(values);
}

function u32(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).setUint32(offset, value, true);
}

function pointerValue(buffer: Uint8Array, offset: number, value: bigint): void {
  new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).setBigUint64(offset, value, true);
}

export class WindowsJobBroker {
  #jobHandle: bigint | number | null = null;
  #kernel: { close(): void; symbols: Record<string, (...args: any[]) => any> } | null = null;

  async launch(options: BrokerLaunch): Promise<BrokerResult> {
    if (platform() !== "win32") throw new Error("isolated_broker_requires_windows");
    const ffi = await import("bun:ffi");
    const { dlopen, FFIType } = ffi;
    const kernel = dlopen("kernel32.dll", {
      CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u64], returns: FFIType.u64 },
      SetHandleInformation: { args: [FFIType.u64, FFIType.u32, FFIType.u32], returns: FFIType.bool },
      CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
      SetInformationJobObject: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.bool },
      AssignProcessToJobObject: { args: [FFIType.u64, FFIType.u64], returns: FFIType.bool },
      WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
      GetExitCodeProcess: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },
      TerminateJobObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.bool },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.bool },
    }) as any;
    const advapi = dlopen("advapi32.dll", {
      CreateProcessWithLogonW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
    }) as any;
    this.#kernel = kernel;
    await mkdir(options.outputDir, { recursive: true });
    if (options.environment.TEMP) await mkdir(options.environment.TEMP, { recursive: true });
    if (options.environment.LOCALAPPDATA) await mkdir(options.environment.LOCALAPPDATA, { recursive: true });
    if (options.environment.APPDATA) await mkdir(options.environment.APPDATA, { recursive: true });
    const stdoutPath = join(options.outputDir, "stdout.log");
    const stderrPath = join(options.outputDir, "stderr.log");
    await Promise.all([rm(stdoutPath, { force: true }), rm(stderrPath, { force: true })]);
    const GENERIC_WRITE = 0x40000000;
    const GENERIC_READ = 0x80000000;
    const FILE_SHARE_READ = 1;
    const FILE_SHARE_WRITE = 2;
    const CREATE_ALWAYS = 2;
    const OPEN_EXISTING = 3;
    const FILE_ATTRIBUTE_NORMAL = 0x80;
    const stdinHandle = kernel.symbols.CreateFileW(wide("NUL"), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, null, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, 0);
    const stdoutHandle = kernel.symbols.CreateFileW(wide(stdoutPath), GENERIC_WRITE, FILE_SHARE_READ, null, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, 0);
    const stderrHandle = kernel.symbols.CreateFileW(wide(stderrPath), GENERIC_WRITE, FILE_SHARE_READ, null, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, 0);
    if (!kernel.symbols.SetHandleInformation(stdinHandle, 1, 1) || !kernel.symbols.SetHandleInformation(stdoutHandle, 1, 1) || !kernel.symbols.SetHandleInformation(stderrHandle, 1, 1)) throw new Error("output_handle_inheritance_failed");
    const job = kernel.symbols.CreateJobObjectW(null, null);
    this.#jobHandle = job;
    const limits = new Uint8Array(144);
    u32(limits, 16, 0x00002000); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!kernel.symbols.SetInformationJobObject(job, 9, limits, limits.byteLength)) throw new Error("job_object_policy_failed");

    const startup = new Uint8Array(104);
    u32(startup, 0, startup.byteLength);
    u32(startup, 60, 0x00000100); // STARTF_USESTDHANDLES
    pointerValue(startup, 80, BigInt(stdinHandle));
    pointerValue(startup, 88, BigInt(stdoutHandle));
    pointerValue(startup, 96, BigInt(stderrHandle));
    const processInfo = new Uint8Array(24);
    const commandLine = wide([quoteWindowsArg(options.executable), ...options.args.map(quoteWindowsArg)].join(" "));
    const environment = envBlock(options.environment);
    const created = advapi.symbols.CreateProcessWithLogonW(
      wide(options.username), wide("."), wide(options.password), 1,
      wide(options.executable), commandLine, 0x00000400 | 0x08000000,
      environment, wide(options.cwd), startup, processInfo,
    );
    options.password = "";
    if (!created) throw new Error("CreateProcessWithLogonW_failed");
    const view = new DataView(processInfo.buffer);
    const processHandle = view.getBigUint64(0, true);
    const threadHandle = view.getBigUint64(8, true);
    const pid = view.getUint32(16, true);
    if (!kernel.symbols.AssignProcessToJobObject(job, processHandle)) {
      kernel.symbols.TerminateJobObject(job, 1);
      throw new Error("job_object_assignment_failed");
    }
    kernel.symbols.CloseHandle(threadHandle);
    const started = Date.now();
    let timedOut = false;
    let stdoutOffset = 0;
    let stderrOffset = 0;
    const emitNew = async (path: string, stream: "stdout" | "stderr", offset: number): Promise<number> => {
      const file = await open(path, "r").catch(() => null);
      if (!file) return offset;
      try {
        const stat = await file.stat();
        if (stat.size <= offset) return offset;
        const buffer = Buffer.alloc(stat.size - offset);
        await file.read(buffer, 0, buffer.length, offset);
        options.onOutput?.(stream, redactText(buffer.toString("utf8")));
        return stat.size;
      } finally { await file.close(); }
    };
    while (kernel.symbols.WaitForSingleObject(processHandle, 50) === 0x00000102) {
      stdoutOffset = await emitNew(stdoutPath, "stdout", stdoutOffset);
      stderrOffset = await emitNew(stderrPath, "stderr", stderrOffset);
      if (Date.now() - started >= options.timeoutMs) {
        timedOut = true;
        kernel.symbols.TerminateJobObject(job, 1460);
        break;
      }
      await Bun.sleep(25);
    }
    await Promise.all([emitNew(stdoutPath, "stdout", stdoutOffset), emitNew(stderrPath, "stderr", stderrOffset)]);
    const exit = new Uint8Array(4);
    kernel.symbols.GetExitCodeProcess(processHandle, exit);
    const exitCode = new DataView(exit.buffer).getUint32(0, true);
    kernel.symbols.CloseHandle(processHandle);
    kernel.symbols.CloseHandle(stdinHandle);
    kernel.symbols.CloseHandle(stdoutHandle);
    kernel.symbols.CloseHandle(stderrHandle);
    kernel.symbols.CloseHandle(job);
    this.#jobHandle = null;
    kernel.close(); advapi.close(); this.#kernel = null;
    const [stdout, stderr] = await Promise.all([readFile(stdoutPath, "utf8"), readFile(stderrPath, "utf8")]);
    return { pid, exitCode, stdout: redactText(stdout), stderr: redactText(stderr), timedOut, durationMs: Date.now() - started };
  }

  interrupt(): boolean {
    if (!this.#jobHandle || !this.#kernel) return false;
    return Boolean(this.#kernel.symbols.TerminateJobObject!(this.#jobHandle, 130));
  }
}
