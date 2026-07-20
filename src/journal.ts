import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { redactValue } from "./redact.ts";
import type { RunEvent } from "./types.ts";

export type EventListener = (event: RunEvent) => void;

export class EventJournal {
  readonly #dataDir: string;
  readonly #listeners = new Map<string, Set<EventListener>>();

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
  }

  pathFor(runId: string): string {
    return join(this.#dataDir, "runs", `${runId}.jsonl`);
  }

  subscribe(runId: string, listener: EventListener): () => void {
    const listeners = this.#listeners.get(runId) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.#listeners.delete(runId);
    };
  }

  async append(event: RunEvent): Promise<void> {
    const clean = redactValue(event);
    const path = this.pathFor(event.runId);
    await mkdir(join(this.#dataDir, "runs"), { recursive: true });
    await appendFile(path, `${JSON.stringify(clean)}\n`, "utf8");
    for (const listener of this.#listeners.get(event.runId) ?? []) listener(clean);
  }
}
