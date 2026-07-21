import { createHash } from "node:crypto";
import { win32 } from "node:path";
import type { PolicyAssessment, ToolCall } from "./types.ts";
import { structuredAssessment } from "./windows-structured.ts";

const DESTRUCTIVE_SHELL = [
  /\bRemove-Item\b/i,
  /\b(?:del|erase|rd|rmdir)\b/i,
  /\b(?:rm)\s+(?:-[^\s]*[rf][^\s]*\s+|--recursive\b)/i,
  /\b(?:Format-Volume|format\.com|Clear-Disk|Initialize-Disk)\b/i,
  /\b(?:Move-Item|Set-Content|Out-File)\b/i,
  /\b(?:reg(?:\.exe)?\s+delete|bcdedit|diskpart)\b/i,
  /\b(?:Stop-Computer|Restart-Computer|shutdown(?:\.exe)?)\b/i,
  /\.Delete\s*\(/i,
];

const OPAQUE_SHELL = [
  /\b(?:Invoke-Expression|iex)\b/i,
  /\s-(?:EncodedCommand|enc)\b/i,
  /\b(?:powershell|pwsh|cmd)(?:\.exe)?\s+\/(?:c|k)\b/i,
  /\bStart-Process\b/i,
  /\[System\.IO\.(?:File|Directory)\]/i,
];

const WINDOWS_PATH = /(?:[A-Za-z]:[\\/][^\r\n;|<>"']*|\\\\[^\s;|<>"']+)/g;

function cleanPath(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").replace(/\//g, "\\");
}

export function canonicalWindowsPath(value: string, cwd = "C:\\"): string {
  let path = cleanPath(value);
  if (path.startsWith("\\\\?\\UNC\\")) path = `\\\\${path.slice(8)}`;
  else if (path.startsWith("\\\\?\\")) path = path.slice(4);
  const resolved = win32.isAbsolute(path) ? win32.normalize(path) : win32.resolve(cwd, path);
  return resolved.replace(/[\\]+$/, "").toLowerCase();
}

export function protectedRoots(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const drive = env.SystemDrive || "C:";
  const roots = [
    env.SystemRoot || `${drive}\\Windows`,
    env.ProgramFiles || `${drive}\\Program Files`,
    env["ProgramFiles(x86)"] || `${drive}\\Program Files (x86)`,
    env.ProgramData || `${drive}\\ProgramData`,
    `${drive}\\Boot`,
    `${drive}\\bootmgr`,
    `${drive}\\Recovery`,
  ];
  return [...new Set(roots.map((root) => canonicalWindowsPath(root)))];
}

export function isProtectedPath(
  target: string,
  roots = protectedRoots(),
  cwd = "C:\\",
): boolean {
  const normalized = canonicalWindowsPath(target, cwd);
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}\\`));
}

export function extractWindowsPaths(script: string): string[] {
  return [...script.matchAll(WINDOWS_PATH)]
    .map((match) => cleanPath(match[0]))
    .filter(Boolean);
}

function fingerprint(call: ToolCall, cwd: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ name: call.name, arguments: call.arguments, cwd }))
    .digest("hex");
}

function blockedAssessment(call: ToolCall, cwd: string, reason: string): PolicyAssessment {
  return {
    decision: "block",
    risk: "blocked",
    reasons: [reason],
    targets: [],
    protectedTargets: [],
    fingerprint: fingerprint(call, cwd),
  };
}

export function assessToolCall(
  call: ToolCall,
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): PolicyAssessment {
  const structured = structuredAssessment(call, cwd);
  if (structured) return structured;
  const args = call.arguments;
  const fp = fingerprint(call, cwd);
  const roots = protectedRoots(env);
  const reasons: string[] = [];
  let targets: string[] = [];
  let destructive = false;
  let opaque = false;

  if (call.name === "win_shell") {
    const script = String(args.script ?? "");
    const compatibilityCommands = [String.fromCharCode(119, 115, 108), String.fromCharCode(98, 97, 115, 104)].join("|");
    const compatibilityPattern = new RegExp(`(?:^|[\\s;&|])(?:${compatibilityCommands})(?:\\.exe)?(?:[\\s;&|]|$)|\\\\\\\\${String.fromCharCode(119, 115, 108)}\\$`, "i");
    if (compatibilityPattern.test(script)) {
      return blockedAssessment(call, cwd, "Linux compatibility-layer execution is outside WinYOLO's native-Windows contract.");
    }
    if (/\\\\(?:\.\?|\?\\GLOBALROOT)\\/i.test(script) || /\\\\[^\\\s]+\\[^\s]+/.test(script)) {
      return blockedAssessment(call, cwd, "UNC and Windows device namespaces are blocked in v1.");
    }
    destructive = DESTRUCTIVE_SHELL.some((pattern) => pattern.test(script));
    opaque = OPAQUE_SHELL.some((pattern) => pattern.test(script));
    targets = extractWindowsPaths(script);
    if (destructive) reasons.push("Recognized destructive or system-mutating shell syntax.");
    if (opaque) reasons.push("Command delegates or obscures its effective target.");
  } else if (call.name === "win_filesystem") {
    const action = String(args.action ?? "");
    const path = String(args.path ?? "");
    const destination = args.destination == null ? "" : String(args.destination);
    targets = [path, destination].filter(Boolean);
    destructive = action === "delete" || action === "move" || action === "write";
    if (destructive) reasons.push(`Filesystem action '${action}' can change or remove data.`);
  } else if (call.name === "win_process") {
    const action = String(args.action ?? "");
    destructive = action === "stop";
    if (destructive) reasons.push("Stopping a process changes live system state.");
  }

  const canonicalTargets = targets.map((target) => canonicalWindowsPath(target, cwd));
  const protectedTargets = canonicalTargets.filter((target) =>
    roots.some((root) => target === root || target.startsWith(`${root}\\`)),
  );

  if (protectedTargets.length) {
    reasons.push("Target resolves inside a protected Windows system root.");
  }

  const unknownDestructiveTarget = destructive && call.name === "win_shell" && targets.length === 0;
  if (unknownDestructiveTarget) reasons.push("Destructive command target could not be resolved statically.");

  const needsConfirmation =
    (destructive && protectedTargets.length > 0) ||
    unknownDestructiveTarget ||
    (destructive && opaque);

  if (needsConfirmation) {
    return {
      decision: "confirm",
      risk: "high",
      reasons,
      targets: canonicalTargets,
      protectedTargets,
      fingerprint: fp,
      confirmationPhrase: `CONFIRM ${fp.slice(0, 8).toUpperCase()}`,
    };
  }

  return {
    decision: "allow",
    risk: destructive ? "medium" : "low",
    reasons: reasons.length ? reasons : ["No recognized destructive behavior."],
    targets: canonicalTargets,
    protectedTargets,
    fingerprint: fp,
  };
}
