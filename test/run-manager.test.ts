import { describe, expect, test } from "bun:test";
import { RunManager } from "../src/run-manager.ts";
import { EventJournal } from "../src/journal.ts";
import { testConfig } from "./helpers.ts";

describe("run manager", () => {
  test("enforces one active run and reaches completed", async () => {
    const config = testConfig();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fakeAgent = { run: async () => { await gate; return "done"; } } as any;
    const manager = new RunManager(config, fakeAgent, new EventJournal(config.dataDir));
    const first = await manager.start({ task: "first" });
    await expect(manager.start({ task: "second" })).rejects.toThrow("active_run_exists");
    release();
    for (let i = 0; i < 30 && manager.get(first.id)?.status !== "completed"; i++) await Bun.sleep(10);
    expect(manager.get(first.id)?.status).toBe("completed");
  });

  test("binds approval to an exact phrase and consumes it once", async () => {
    const config = testConfig();
    const phrase = "CONFIRM DEADBEEF";
    const fakeAgent = {
      run: async (options: any, callbacks: any) => {
        const approved = await callbacks.requestApproval({
          id: "approval-1",
          runId: options.runId,
          call: { callId: "call-1", name: "win_shell", arguments: { script: "Remove-Item C:\\Windows\\x" } },
          assessment: {
            decision: "confirm",
            risk: "high",
            reasons: ["protected"],
            targets: ["c:\\windows\\x"],
            protectedTargets: ["c:\\windows\\x"],
            fingerprint: "deadbeef",
            confirmationPhrase: phrase,
          },
          createdAt: new Date().toISOString(),
        });
        return approved ? "approved" : "rejected";
      },
    } as any;
    const manager = new RunManager(config, fakeAgent, new EventJournal(config.dataDir));
    const run = await manager.start({ task: "protected fixture" });
    for (let i = 0; i < 30 && manager.get(run.id)?.status !== "awaiting_confirmation"; i++) await Bun.sleep(10);

    expect(manager.confirm(run.id, "approval-1", "approve", "wrong phrase")).toBe(false);
    expect(manager.get(run.id)?.status).toBe("awaiting_confirmation");
    expect(manager.confirm(run.id, "approval-1", "approve", phrase)).toBe(true);
    expect(manager.confirm(run.id, "approval-1", "approve", phrase)).toBe(false);
    for (let i = 0; i < 30 && manager.get(run.id)?.status !== "completed"; i++) await Bun.sleep(10);
    expect(manager.get(run.id)?.answer).toBe("approved");
  });
});
