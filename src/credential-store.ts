import { platform } from "node:os";
import { readFile } from "node:fs/promises";
import { runNativeShell } from "./executor.ts";

export async function readRunnerCredential(path: string, cwd: string): Promise<string> {
  if (platform() !== "win32") throw new Error("runner_credentials_require_windows");
  await readFile(path); // precise missing-file error before starting PowerShell
  const encodedPath = Buffer.from(path, "utf8").toString("base64");
  const script = [
    "Add-Type -AssemblyName System.Security",
    `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))`,
    "$c=[Convert]::FromBase64String((Get-Content -LiteralPath $p -Raw))",
    "$b=[Security.Cryptography.ProtectedData]::Unprotect($c,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)",
    "try {[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))} finally {[Array]::Clear($b,0,$b.Length);[Array]::Clear($c,0,$c.Length)}",
  ].join(";");
  const result = await runNativeShell({ shell: "powershell", script, cwd, timeoutMs: 10_000, maxOutputBytes: 4_096 });
  if (!result.ok || !result.stdout) throw new Error("runner_credential_decryption_failed");
  return result.stdout;
}
