import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const productionRoots = ["src", "plugins", "scripts"];
const allowed = new Set(["scripts/benchmark-compatibility.ts", "scripts/source-scan.ts"]);
const forbidden = [/(?:^|[^A-Za-z])wsl(?:\.exe)?(?:[^A-Za-z]|$)/i, /(?:^|[^A-Za-z])bash(?:\.exe)?(?:[^A-Za-z]|$)/i, /\/bin\//, /\\\\wsl\$/i];
const failures: string[] = [];
async function walk(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const next = join(path, entry.name); if (entry.isDirectory()) await walk(next); else {
      const name = relative(root, next).replaceAll("\\", "/"); if (allowed.has(name)) continue;
      if (!/\.(?:ts|js|json|ps1|cmd)$/i.test(name)) continue;
      const content = await readFile(next, "utf8");
      for (const pattern of forbidden) if (pattern.test(content)) failures.push(`${name}: ${pattern}`);
    }
  }
}
for (const path of productionRoots) await walk(join(root, path));
if (failures.length) { process.stderr.write(`Forbidden production transport references:\n${failures.join("\n")}\n`); process.exit(1); }
process.stdout.write("SOURCE_SCAN_OK production is Windows-native; benchmark quarantine is explicit.\n");
