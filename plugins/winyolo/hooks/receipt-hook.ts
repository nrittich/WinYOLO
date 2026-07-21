import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const event = process.argv[2] ?? "Unknown";
const dataDir = process.env.PLUGIN_DATA ?? process.env.CLAUDE_PLUGIN_DATA;
const raw = await Bun.stdin.text();
let input: Record<string, unknown> = {};
try { input = raw.trim() ? JSON.parse(raw) : {}; } catch { process.exit(0); }
const text = JSON.stringify(input.tool_input ?? {});
const linuxLaunchers = [String.fromCharCode(119, 115, 108), String.fromCharCode(98, 97, 115, 104)].join("|");
const boundaryPattern = new RegExp(`(?:^|[\\s;&|])(?:${linuxLaunchers})(?:\\.exe)?(?:[\\s;&|]|$)|\\\\\\\\${String.fromCharCode(119, 115, 108)}\\$|\\\\\\\\[.?]\\\\|--dangerously-bypass-approvals-and-sandbox|sandbox_mode\\s*=\\s*[\"']?danger-full-access`, "i");
const secretPattern = /(?:^|[\\/])(?:\.env(?:\.[^\\/\s"']+)?|\.ssh|\.aws|auth\.json|runner\.dpapi)(?:$|[\\/\s"'])/i;
const blocked = boundaryPattern.test(text) || secretPattern.test(text);

const clean = JSON.parse(JSON.stringify(input, (key, value) =>
  /(?:password|secret|token|authorization|api[_-]?key|credential|environment|transcript_path)/i.test(key) ? "[REDACTED]" : value
));
const receipt = {
  schema: 2, id: crypto.randomUUID(), at: new Date().toISOString(), type: `hook.${event}`,
  sessionId: String(input.session_id ?? "") || null, threadId: null, turnId: String(input.turn_id ?? "") || null,
  toolCallId: String(input.tool_use_id ?? "") || null, checkpointId: process.env.WINYOLO_CHECKPOINT_ID ?? null,
  processId: process.pid, command: null, cwd: String(input.cwd ?? "") || null,
  risk: blocked ? "blocked" : event === "PermissionRequest" ? "high" : null,
  approvalSource: event === "PermissionRequest" ? "codex" : null, durationMs: null, exitStatus: null,
  outputBytes: Buffer.byteLength(raw), finalDiffHash: null, data: clean,
};
if (dataDir) {
  const dir = join(dataDir, "receipts"); await mkdir(dir, { recursive: true });
  await appendFile(join(dir, `${receipt.sessionId ?? "unknown"}.jsonl`), `${JSON.stringify(receipt)}\n`, "utf8");
}
if (event === "PreToolUse" && blocked) {
  console.error("WinYOLO blocked a compatibility transport, device namespace, secret path, or unrestricted Codex escalation.");
  process.exit(2);
}
if (event === "SessionStart") {
  console.log(JSON.stringify({ systemMessage: "WinYOLO 0.3: Safe workspace sandbox is the default; unrestricted escalation is blocked." }));
}
