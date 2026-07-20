import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const pluginRoot = resolve(projectRoot, "plugins", "winyolo");
const manifestPath = resolve(pluginRoot, ".codex-plugin", "plugin.json");
const marketplacePath = resolve(projectRoot, ".agents", "plugins", "marketplace.json");
const fail = (message: string): never => { throw new Error(`Plugin validation: ${message}`); };

if (!existsSync(manifestPath)) fail("missing .codex-plugin/plugin.json");
const manifest = await Bun.file(manifestPath).json() as Record<string, any>;
if (manifest.name !== "winyolo") fail("manifest name must match folder name");
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(manifest.version))) fail("version must be semver");
if (!manifest.description || !manifest.author?.name) fail("description and author.name are required");
for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
  if (!manifest.interface?.[field]) fail(`interface.${field} is required`);
}
if (JSON.stringify(manifest).includes("[TODO:")) fail("manifest contains TODO placeholders");
for (const field of ["skills", "mcpServers"]) {
  const relative = manifest[field];
  if (typeof relative !== "string" || !relative.startsWith("./")) fail(`${field} must be a ./ relative path`);
  if (!existsSync(resolve(pluginRoot, relative))) fail(`${field} target does not exist`);
}
if (manifest.apps && !existsSync(resolve(pluginRoot, manifest.apps))) fail("apps declared without companion file");
if (manifest.hooks) fail("unsupported hooks field must be omitted");

const marketplace = await Bun.file(marketplacePath).json() as Record<string, any>;
const entry = marketplace.plugins?.find((item: any) => item.name === "winyolo");
if (!entry) fail("marketplace entry is missing");
if (entry.source?.path !== "./plugins/winyolo") fail("marketplace source path is invalid");
if (!entry.policy?.installation || !entry.policy?.authentication || !entry.category) fail("marketplace policy/category fields are required");

console.log(`PLUGIN_VALID ${manifest.name}@${manifest.version}`);
