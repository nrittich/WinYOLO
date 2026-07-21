import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hook = join(import.meta.dir, "..", "plugins", "winyolo", "hooks", "receipt-hook.ts");
describe("bundled receipt hooks", () => {
  test("blocks secret-path reads and writes a redacted schema-2 receipt", async () => {
    const data = await mkdtemp(join(tmpdir(), "winyolo-hook-"));
    const child = Bun.spawn([process.execPath, "run", hook, "PreToolUse"], { env: { ...process.env, PLUGIN_DATA: data }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    child.stdin.write(JSON.stringify({ session_id: "session-1", turn_id: "turn-1", cwd: "C:\\repo", tool_name: "Bash", tool_input: { command: "Get-Content C:\\repo\\.env", authorization: "Bearer should-not-leak" } })); child.stdin.end();
    expect(await child.exited).toBe(2);
    const receipt = await readFile(join(data, "receipts", "session-1.jsonl"), "utf8");
    expect(receipt).toContain('"schema":2'); expect(receipt).toContain('"risk":"blocked"'); expect(receipt).not.toContain("should-not-leak");
  });
});
