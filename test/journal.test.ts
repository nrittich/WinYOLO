import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventJournal } from "../src/journal.ts";

describe("event journal", () => {
  test("persists redacted JSONL and notifies subscribers", async () => {
    const root = await mkdtemp(join(tmpdir(), "winyolo-journal-"));
    const journal = new EventJournal(root);
    const seen: string[] = [];
    const off = journal.subscribe("run", (event) => seen.push(event.message));
    await journal.append({ id: 1, runId: "run", at: new Date().toISOString(), type: "run.failed", message: "key sk-abcdefghijklmnopqrst", data: { authorization: "Bearer secret" } });
    off();
    const content = await readFile(journal.pathFor("run"), "utf8");
    expect(content).not.toContain("sk-abcdefghijklmnopqrst");
    expect(content).not.toContain("Bearer secret");
    expect(seen[0]).toContain("REDACTED");
  });
});
