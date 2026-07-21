import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const installerPath = join(import.meta.dir, "..", "scripts", "install.ps1");

describe("runner authentication provisioning contract", () => {
  test("requires an explicit provisioning switch and dedicated Codex home", async () => {
    const installer = await readFile(installerPath, "utf8");
    expect(installer).toContain("[switch]$ProvisionRunnerAuth");
    expect(installer).toContain("$RunnerCodexHome = Join-Path $DataRoot 'runner-codex-home'");
    expect(installer).toContain("$SourceAuth = Join-Path (Join-Path $InstallUserProfile '.codex') 'auth.json'");
    expect(installer).toContain("$env:CODEX_HOME = $RunnerCodexHome");
    expect(installer).toContain('sandbox = "elevated"');
    expect(installer).toContain("codex plugin add winyolo@winyolo-local --json");
    expect(installer).toContain("if ($Full -and -not (Test-Administrator))");
    expect(installer).not.toMatch(/if \(\$Full\) \{[^}]*ProvisionRunnerAuth/s);
  });

  test("applies narrow ACLs and never prints credential material", async () => {
    const installer = await readFile(installerPath, "utf8");
    expect(installer).toContain("& icacls.exe $RunnerCodexHome /inheritance:r /grant:r");
    expect(installer).toContain("& icacls.exe $RunnerAuthPath /inheritance:r /grant:r");
    expect(installer).toContain('"${RunnerName}:(X)"');
    expect(installer).toContain("'CodexSandboxUsers:(OI)(CI)M'");
    expect(installer).toContain('"${RunnerName}:M"');
    expect(installer).toContain("'*S-1-5-18:F' '*S-1-5-32-544:F'");
    expect(installer).toContain("without displaying credentials");
    expect(installer).not.toMatch(/Write-Host\s+\$AuthDocument/);
  });
});
