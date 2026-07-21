import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIsolatedCodexArgs, IsolationManager, type IsolationEvent, type IsolationRun } from "../src/isolation.ts";
import { testConfig } from "./helpers.ts";

describe("isolation persistence", () => {
  test("places global approval policy before the exec subcommand", () => {
    expect(buildIsolatedCodexArgs("C:\\repo", "repair")).toEqual([
      "--ask-for-approval", "never", "exec", "--sandbox", "danger-full-access", "--config",
      "sandbox_workspace_write.network_access=false", "--config", 'windows.sandbox="elevated"',
      "--config", 'cli_auth_credentials_store="file"',
      "--config", "shell_environment_policy.ignore_default_excludes=false", "--config",
      'shell_environment_policy.exclude=["CODEX_ACCESS_TOKEN","CODEX_API_KEY","OPENAI_API_KEY","*TOKEN*","*KEY*","*SECRET*"]',
      "--cd", "C:\\repo", "repair",
    ]);
  });
  test("fails before checkpoint creation when runner authentication is unprovisioned", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "winyolo-isolation-"));
    const runnerCredentialPath = join(dataDir, "protected", "runner.dpapi");
    await mkdir(join(dataDir, "protected"), { recursive: true });
    await writeFile(runnerCredentialPath, "fixture", "utf8");
    const manager = new IsolationManager({ ...testConfig(), dataDir, runnerCredentialPath });

    await expect(manager.start("repair", "C:\\repo")).rejects.toThrow("-ProvisionRunnerAuth");
    expect(manager.list()).toHaveLength(0);
  });
  test("rehydrates unfinished runs as interrupted and records recovery", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "winyolo-isolation-"));
    const config = { ...testConfig(), dataDir };
    const id = "persisted-run";
    const dir = join(dataDir, "isolation", id);
    await mkdir(dir, { recursive: true });
    const created: IsolationEvent = {
      schema: 2, id: 1, runId: id, at: "2026-01-01T00:00:00.000Z", type: "isolation.created",
      sessionId: null, threadId: null, turnId: null, toolCallId: null, checkpointId: "cp-1",
      processId: 42, command: null, cwd: "C:\\repo", risk: "constrained", approvalSource: "isolated-policy",
      durationMs: null, exitStatus: null, outputBytes: null, finalDiffHash: null, message: "created",
    };
    const run: IsolationRun = {
      id, task: "repair", sourceCwd: "C:\\repo", status: "running", checkpointId: "cp-1", processId: 42,
      createdAt: created.at, updatedAt: created.at, events: [],
    };
    await writeFile(join(dir, "run.json"), JSON.stringify(run), "utf8");
    await writeFile(join(dir, "events.jsonl"), `${JSON.stringify(created)}\n`, "utf8");

    const manager = new IsolationManager(config);
    await manager.hydrate();

    const recovered = manager.get(id)!;
    expect(recovered.status).toBe("interrupted");
    expect(recovered.error).toBe("backend_restarted");
    expect(recovered.events.at(-1)?.message).toContain("Backend restart");
    expect((await readFile(join(dir, "run.json"), "utf8"))).toContain('"status": "interrupted"');
    expect((await readFile(join(dir, "events.jsonl"), "utf8")).trim().split(/\r?\n/)).toHaveLength(2);
  });
});
