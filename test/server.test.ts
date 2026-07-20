import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "../src/server.ts";
import { EventJournal } from "../src/journal.ts";
import { RunManager } from "../src/run-manager.ts";
import { testConfig } from "./helpers.ts";

const servers: Bun.Server<undefined>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });

describe("localhost server", () => {
  test("serves health and dashboard without exposing secrets", async () => {
    const config = testConfig({ port: 0 });
    const server = createServer(config);
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect((await health.json() as any).status).toBe("ok");
    const html = await (await fetch(base)).text();
    expect(html).toContain("WinYOLO");
    expect(html).not.toContain(config.apiKey!);
  });

  test("rejects hostile browser origins", async () => {
    const server = createServer(testConfig({ port: 0 }));
    servers.push(server);
    const response = await fetch(`http://127.0.0.1:${server.port}/api/runs`, { headers: { Origin: "https://evil.example" } });
    expect(response.status).toBe(403);
  });

  test("lists canonical tools", async () => {
    const server = createServer(testConfig({ port: 0 }));
    servers.push(server);
    const body = await (await fetch(`http://127.0.0.1:${server.port}/api/tools`)).json() as any;
    expect(body.tools.map((tool: any) => tool.name)).toEqual(["win_system_inspect", "win_shell", "win_filesystem", "win_process"]);
  });

  test("creates one active run, rejects concurrency, and streams events", async () => {
    const config = testConfig({ port: 0 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const agent = { run: async () => { await gate; return "done"; } } as any;
    const manager = new RunManager(config, agent, new EventJournal(config.dataDir));
    const server = createServer(config, manager);
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;

    const created = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "hold this run" }),
    });
    expect(created.status).toBe(202);
    const run = (await created.json() as any).run;
    const conflict = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "second run" }),
    });
    expect(conflict.status).toBe(409);

    const stream = await fetch(`${base}/api/runs/${run.id}/events`);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("run.created");
    await reader.cancel();

    const detail = await (await fetch(`${base}/api/runs/${run.id}`)).json() as any;
    expect(detail.run.task).toBe("hold this run");
    expect(detail.run.events.length).toBeGreaterThanOrEqual(2);
    release();
  });
});
