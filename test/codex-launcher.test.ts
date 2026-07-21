import { describe, expect, test } from "bun:test";
import { assertSafeBoundary, buildCodexArgs, ensureCompanionService, launchCodex, resolveCodexExecutable } from "../src/codex-launcher.ts";
import { testConfig } from "./helpers.ts";

const NETWORK = ["--config", "sandbox_workspace_write.network_access=false"];
describe("terminal-first Codex launcher", () => {
  test("bare launcher is Safe and preserves Codex arguments", () => {
    expect(buildCodexArgs([])).toEqual(["--sandbox", "workspace-write", "--ask-for-approval", "on-request", ...NETWORK]);
    const rich = ["--model", "gpt-test", "--search", "--profile", "work", "--cd", "C:\\repo", "resume", "thread-1"];
    expect(buildCodexArgs(rich).slice(-rich.length)).toEqual(rich);
  });

  test("constrained YOLO removes approvals but retains workspace and network boundaries", () => {
    expect(buildCodexArgs(["resume"], "yolo")).toEqual(["--sandbox", "workspace-write", "--ask-for-approval", "never", ...NETWORK, "resume"]);
    expect(buildCodexArgs(["-s", "read-only"], "yolo")).toEqual(["--ask-for-approval", "never", ...NETWORK, "-s", "read-only"]);
    expect(buildCodexArgs(["-a", "on-request"], "yolo")).toEqual(["--sandbox", "workspace-write", ...NETWORK, "-a", "on-request"]);
  });

  test("rejects every unrestricted launcher escape", () => {
    for (const args of [["--yolo"], ["--dangerously-bypass-approvals-and-sandbox"], ["--sandbox", "danger-full-access"], ["--sandbox=danger-full-access"], ["-c", "sandbox_mode=\"danger-full-access\""]]) {
      expect(() => assertSafeBoundary(args)).toThrow();
    }
  });

  test("prefers codex.exe and propagates child process contract and exit code", async () => {
    expect(resolveCodexExecutable((name) => name === "codex.exe" ? "C:\\bin\\codex.exe" : null, () => false)).toBe("C:\\bin\\codex.exe");
    let command: string[] = []; let options: Record<string, unknown> = {};
    const code = await launchCodex(["--model", "gpt-test"], "yolo", { executable: "codex.exe", cwd: "C:\\repo", env: { TEST: "1" }, spawn: ((argv: string[], spawnOptions: Record<string, unknown>) => { command = argv; options = spawnOptions; return { exited: Promise.resolve(23) }; }) as any });
    expect(code).toBe(23); expect(command.slice(0, 7)).toEqual(["codex.exe", "--sandbox", "workspace-write", "--ask-for-approval", "never", "--config", "sandbox_workspace_write.network_access=false"]);
    expect(options).toMatchObject({ cwd: "C:\\repo", env: { TEST: "1" }, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  });

  test("starts detached companion only when health is unavailable", async () => {
    const config = testConfig({ port: 4747 }); let spawned = 0; let unref = 0;
    const spawn = (() => { spawned += 1; return { unref: () => { unref += 1; } }; }) as any;
    expect(await ensureCompanionService(config, { fetcher: (() => Promise.resolve(Response.json({ status: "ok" }))) as any, spawn })).toBe(false);
    expect(await ensureCompanionService(config, { fetcher: (() => Promise.reject(new Error("offline"))) as any, spawn, cliPath: "C:\\WinYOLO\\src\\cli.ts" })).toBe(true);
    expect([spawned, unref]).toEqual([1, 1]);
  });
});
