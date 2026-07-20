import type { AgentToolDefinition } from "./types.ts";

export const TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    type: "function",
    name: "win_system_inspect",
    description: "Inspect this Windows PC using native CIM and PowerShell commands. Use before making assumptions about the machine.",
    parameters: {
      type: "object",
      properties: {
        area: {
          type: "string",
          enum: ["summary", "os", "hardware", "network", "disks", "devtools"],
          description: "The system area to inspect.",
        },
      },
      required: ["area"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "win_shell",
    description: "Run a native Windows PowerShell or cmd script. Never invoke WSL, bash, or a Linux subsystem.",
    parameters: {
      type: "object",
      properties: {
        shell: { type: "string", enum: ["powershell", "cmd"] },
        script: { type: "string", description: "The exact native Windows script to execute." },
        cwd: { type: ["string", "null"], description: "Working directory, or null for the run directory." },
        timeout_ms: { type: ["number", "null"], description: "Requested timeout or null for the configured default." },
        reason: { type: "string", description: "Short user-visible explanation of why this command is needed." },
      },
      required: ["shell", "script", "cwd", "timeout_ms", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "win_filesystem",
    description: "List, read, write, move, or delete files using the Windows-resident Bun process.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read", "write", "move", "delete"] },
        path: { type: "string" },
        content: { type: ["string", "null"] },
        destination: { type: ["string", "null"] },
        recursive: { type: "boolean" },
      },
      required: ["action", "path", "content", "destination", "recursive"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "win_process",
    description: "List, inspect, start, or stop a native Windows process.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "status", "start", "stop"] },
        pid: { type: ["number", "null"] },
        name: { type: ["string", "null"] },
        command: { type: ["string", "null"] },
      },
      required: ["action", "pid", "name", "command"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export const WINYOLO_INSTRUCTIONS = `You are WinYOLO, a transparent Windows-native automation agent.

Operate only through the supplied tools. Use native Windows PowerShell, cmd, CIM, and Win32-oriented utilities. Never use WSL, bash, /bin/sh, or Linux paths. Inspect before changing. Prefer structured filesystem/process tools over raw shell when they fit. For every shell command, provide a crisp reason. Keep actions bounded and verifiable. Do not request elevation or attempt to bypass a denied action. If an action is rejected, adapt or explain. End with a concise summary of what changed and how it was verified.

WinYOLO's risk classifier is advisory, not a sandbox. A local user may need to confirm recognized destructive actions.`;
