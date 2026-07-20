import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolAuthority } from "../src/executor.ts";
import { testConfig } from "./helpers.ts";
import type { ToolCall } from "../src/types.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("canonical tool authority", () => {
  test("writes, reads, and deletes a workspace fixture", async () => {
    const root = await mkdtemp(join(tmpdir(), "winyolo-exec-"));
    roots.push(root);
    const authority = new ToolAuthority(testConfig({ defaultCwd: root }));
    const path = join(root, "space & unicode-⚡", "file.txt");
    const write: ToolCall = { callId: "w", name: "win_filesystem", arguments: { action: "write", path, content: "hello", destination: null, recursive: false } };
    expect((await authority.execute(write, root)).ok).toBe(true);
    expect(await readFile(path, "utf8")).toBe("hello");
    const read: ToolCall = { callId: "r", name: "win_filesystem", arguments: { action: "read", path, content: null, destination: null, recursive: false } };
    expect((await authority.execute(read, root)).data).toBe("hello");
    const del: ToolCall = { callId: "d", name: "win_filesystem", arguments: { action: "delete", path, content: null, destination: null, recursive: false } };
    expect((await authority.execute(del, root)).ok).toBe(true);
  });

  test("does not execute a protected action without confirmation", async () => {
    const authority = new ToolAuthority(testConfig());
    const call: ToolCall = { callId: "x", name: "win_shell", arguments: { shell: "powershell", script: "Remove-Item 'C:\\Windows\\fixture' -Force", cwd: null, timeout_ms: null, reason: "test" } };
    const result = await authority.execute(call, process.cwd());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("approval_required");
  });

  test("rejects Linux subsystem commands before spawn", async () => {
    const authority = new ToolAuthority(testConfig());
    const call: ToolCall = { callId: "x", name: "win_shell", arguments: { shell: "powershell", script: "wsl uname -a", cwd: null, timeout_ms: null, reason: "test" } };
    const result = await authority.execute(call, process.cwd());
    expect(result.assessment.decision).toBe("block");
    expect(result.ok).toBe(false);
  });
});
