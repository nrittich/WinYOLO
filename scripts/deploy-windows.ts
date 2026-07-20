#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

const host = process.env.WINYOLO_WINDOWS_HOST?.trim();
const user = process.env.WINYOLO_WINDOWS_USER?.trim();
const waitMode = process.argv.includes("--wait");
const pollMs = Number(process.env.WINYOLO_DEPLOY_POLL_MS ?? 30_000);
const deadlineMs = Number(process.env.WINYOLO_DEPLOY_DEADLINE_MS ?? 43_200_000);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = "%USERPROFILE%\\AI\\Project\\WinYOLO";
const sshOptions = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new"];

if (!host || !user) {
  throw new Error("Set WINYOLO_WINDOWS_HOST and WINYOLO_WINDOWS_USER.");
}
if (!Number.isFinite(pollMs) || pollMs < 1_000 || !Number.isFinite(deadlineMs) || deadlineMs < pollMs) {
  throw new Error("Invalid deploy polling configuration.");
}

const target = `${user}@${host}`;

async function run(command: string[], stdin: "ignore" | ReadableStream<Uint8Array> = "ignore"): Promise<Result> {
  const proc = Bun.spawn(command, { stdin, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function ssh(command: string): Promise<Result> {
  return run(["ssh", ...sshOptions, target, command]);
}

function assertOk(label: string, result: Result): void {
  if (result.code !== 0) {
    throw new Error(`${label} failed (${result.code}): ${(result.stderr || result.stdout).trim()}`);
  }
}

async function reachable(): Promise<boolean> {
  const result = await ssh("cmd /d /c echo WINYOLO_PC_REACHABLE");
  return result.code === 0 && result.stdout.includes("WINYOLO_PC_REACHABLE");
}

async function transfer(): Promise<void> {
  assertOk("destination creation", await ssh(`cmd /d /c if not exist "${destination}" mkdir "${destination}"`));
  const archive = Bun.spawn([
    "tar", "cf", "-",
    "--exclude=node_modules",
    "--exclude=.env",
    "--exclude=.winyolo",
    "-C", projectRoot,
    ".",
  ], { stdout: "pipe", stderr: "pipe" });
  const extract = Bun.spawn(
    ["ssh", ...sshOptions, target, `tar xf - -C "${destination}"`],
    { stdin: archive.stdout, stdout: "pipe", stderr: "pipe" },
  );
  const [archiveError, archiveCode, extractOut, extractError, extractCode] = await Promise.all([
    new Response(archive.stderr).text(),
    archive.exited,
    new Response(extract.stdout).text(),
    new Response(extract.stderr).text(),
    extract.exited,
  ]);
  assertOk("archive creation", { code: archiveCode, stdout: "", stderr: archiveError });
  assertOk("archive extraction", { code: extractCode, stdout: extractOut, stderr: extractError });
}

async function ensureBun(): Promise<void> {
  const check = await ssh("cmd /d /c where bun");
  if (check.code === 0) return;
  process.stdout.write("Bun is absent; installing the official Windows build.\n");
  const install = await ssh('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"');
  assertOk("Bun installation", install);
}

async function verify(): Promise<void> {
  const prefix = `cmd /d /s /c "set PATH=%USERPROFILE%\\.bun\\bin;%PATH%&& cd /d "${destination}"&&`;
  assertOk("WinYOLO install", await ssh(`${prefix} powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\install.ps1"`));
  const smoke = await ssh(`${prefix} powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\smoke-windows.ps1"`);
  process.stdout.write(smoke.stdout);
  assertOk("Windows smoke", smoke);

  const codex = await ssh("cmd /d /c where codex");
  if (codex.code === 0) {
    const plugin = await ssh(`${prefix} codex plugin marketplace add . --json&& codex plugin add winyolo@winyolo-local --json"`);
    assertOk("Codex plugin installation", plugin);
    process.stdout.write(plugin.stdout);
  } else {
    process.stdout.write("Codex CLI is not installed; the optional plugin was not installed.\n");
  }
}

async function deploy(): Promise<void> {
  process.stdout.write(`Deploying WinYOLO to ${target}:${destination}\n`);
  await ensureBun();
  await transfer();
  await verify();
  process.stdout.write("WINYOLO_WINDOWS_DEPLOY_OK\n");
}

const started = Date.now();
while (!(await reachable())) {
  if (!waitMode || Date.now() - started >= deadlineMs) {
    throw new Error(`Windows PC ${target} is unreachable.`);
  }
  process.stdout.write(`${new Date().toISOString()} Windows PC offline; retrying.\n`);
  await Bun.sleep(pollMs);
}
await deploy();
