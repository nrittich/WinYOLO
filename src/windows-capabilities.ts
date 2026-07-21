import { platform, release, version } from "node:os";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const COMMANDS = {
  bun: ["bun.exe", "bun"], codex: ["codex.exe", "codex"], git: ["git.exe", "git"],
  dotnet: ["dotnet.exe", "dotnet"], msbuild: ["MSBuild.exe", "msbuild"],
  nuget: ["nuget.exe", "nuget"], winget: ["winget.exe", "winget"], vswhere: ["vswhere.exe", "vswhere"],
} as const;

export function windowsCapabilities(which: (name: string) => string | null = Bun.which): Record<string, unknown> {
  const tools = Object.fromEntries(Object.entries(COMMANDS).map(([name, candidates]) => [name, candidates.map(which).find(Boolean) ?? null]));
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const windowsApps = join(process.env.LOCALAPPDATA ?? "C:\\Users\\Default\\AppData\\Local", "Microsoft", "WindowsApps");
  const knownWinget = join(windowsApps, "winget.exe");
  if (!tools.winget && platform() === "win32") {
    try {
      // App Execution Aliases are zero-length reparse entries. Bun's `which`
      // and `existsSync` can intentionally skip them even though Windows can
      // execute them, so inspect the alias directory by name.
      if (readdirSync(windowsApps).some((name) => name.toLowerCase() === "winget.exe")) tools.winget = knownWinget;
    } catch { /* App Execution Alias is absent or disabled. */ }
  }
  const knownVswhere = join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!tools.vswhere && existsSync(knownVswhere)) tools.vswhere = knownVswhere;
  if (!tools.msbuild && tools.vswhere) {
    const located = Bun.spawnSync([tools.vswhere, "-latest", "-products", "*", "-requires", "Microsoft.Component.MSBuild", "-find", "MSBuild\\**\\Bin\\MSBuild.exe"], { stdout: "pipe", stderr: "ignore" });
    if (located.success) tools.msbuild = located.stdout.toString().split(/\r?\n/).find(Boolean) ?? null;
  }
  if (!tools.nuget && tools.dotnet) tools.nuget = `${tools.dotnet} nuget`;
  const sdkRoot = join(programFilesX86, "Windows Kits", "10", "bin");
  const windowsSdk = existsSync(sdkRoot) ? sdkRoot : null;
  return {
    platform: platform(), release: release(), version: version(), native: platform() === "win32",
    zeroLinuxCompatibilityPolicy: true, jobObjectBroker: platform() === "win32", structuredTools: [
      "win_path", "win_dotnet", "win_msbuild", "win_nuget", "win_winget",
      "win_service", "win_registry", "win_eventlog", "win_acl",
    ], tools, windowsSdk,
  };
}
