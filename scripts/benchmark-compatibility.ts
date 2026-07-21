import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { platform } from "node:os";

export async function runCompatibilityBenchmark(dataDir: string): Promise<string> {
  if (platform() !== "win32") throw new Error("The comparison benchmark can run only on Windows.");
  const started = performance.now();
  const command = ["wsl.exe", "--exec", "sh", "-lc", "printf 'ready\\n'; uname -r; /usr/bin/time -f '%e %M' true"];
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: process.env });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const evidence = {
    schema: 1, warning: "Machine-specific comparison evidence; never a universal performance claim.",
    at: new Date().toISOString(), setup: ["Explicit BENCHMARK-ONLY confirmation received", "No production WinYOLO path imported this module"],
    coldStartMs: Math.round(performance.now() - started), exitCode, stdout, stderr,
    measurements: { disk: "collect manually with Get-Volume and distribution VHD size", memory: "collect manually with Get-Process", buildTest: "run the same demo/BrokenBuild command in both environments", pathFriction: "record path translation and quoting failures verbatim" },
  };
  const dir = join(dataDir, "benchmarks"); await mkdir(dir, { recursive: true });
  const path = join(dir, `wsl-comparison-${Date.now()}.json`); await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8"); return path;
}
