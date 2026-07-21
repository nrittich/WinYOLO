import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointManager, resolveGitExecutable } from "../src/checkpoints.ts";

function git(cwd: string, ...args: string[]): void { const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" }); if (!result.success) throw new Error(result.stderr.toString()); }
describe("Git checkpoint recovery", () => {
  test("accepts isolated delta while preserving original dirty and untracked state", async () => {
    const root = await mkdtemp(join(tmpdir(), "winyolo-repo-")); git(root, "init");
    await writeFile(join(root, "tracked.txt"), "base\n"); git(root, "add", "."); git(root, "-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-m", "base");
    await writeFile(join(root, "tracked.txt"), "dirty user state\n"); await writeFile(join(root, "untracked.txt"), "user file\n"); await writeFile(join(root, "._."), "metadata\n");
    const data = await mkdtemp(join(tmpdir(), "winyolo-data-")); const manager = new CheckpointManager(data); const record = await manager.prepare(root, "fixture");
    expect((await stat(join(record.workspace, ".git"))).isDirectory()).toBe(true);
    expect(await readFile(join(record.workspace, "tracked.txt"), "utf8")).toBe("dirty user state\n");
    await expect(readFile(join(record.workspace, "._."), "utf8")).rejects.toThrow();
    await writeFile(join(record.workspace, "isolated.txt"), "isolated result\n");
    const diff = await manager.diff(record.id); expect(diff.patch).toContain("isolated.txt");
    await manager.accept(record.id);
    expect(await readFile(join(root, "tracked.txt"), "utf8")).toBe("dirty user state\n");
    expect(await readFile(join(root, "untracked.txt"), "utf8")).toBe("user file\n");
    expect(await readFile(join(root, "isolated.txt"), "utf8")).toBe("isolated result\n");
    expect(await readFile(record.patchPath, "utf8")).toContain("isolated.txt");
    expect((await manager.diff(record.id)).patch).toContain("isolated.txt");
  });
  test("refuses non-Git directories with remediation", async () => {
    const root = await mkdtemp(join(tmpdir(), "winyolo-nongit-"));
    const data = await mkdtemp(join(tmpdir(), "winyolo-data-")); await expect(new CheckpointManager(data).prepare(root, "fixture")).rejects.toThrow("git init");
  });
  test("resolves installed Windows Git when PATH is stale", () => {
    const programFiles = join("C:\\", "Program Files");
    const expected = join(programFiles, "Git", "cmd", "git.exe");
    expect(resolveGitExecutable(() => null, (path) => path === expected, { ProgramFiles: programFiles })).toBe(expected);
  });
});
