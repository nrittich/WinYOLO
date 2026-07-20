import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "../src/server.ts";
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
});
