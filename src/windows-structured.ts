import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { AgentToolDefinition, PolicyAssessment, ToolCall } from "./types.ts";

type Shape = { actions: readonly string[]; required?: readonly string[] };
const SHAPES: Partial<Record<ToolCall["name"], Shape>> = {
  win_path: { actions: ["inspect", "traverse"], required: ["path"] },
  win_dotnet: { actions: ["discover", "inspect", "restore", "build", "test"] },
  win_msbuild: { actions: ["discover", "build", "sdk"] },
  win_nuget: { actions: ["sources", "restore", "list", "vulnerable"] },
  win_winget: { actions: ["search", "show", "install", "upgrade"] },
  win_service: { actions: ["query", "start", "stop", "restart"], required: ["name"] },
  win_registry: { actions: ["read", "query", "write"], required: ["hive", "path"] },
  win_eventlog: { actions: ["query"] },
  win_acl: { actions: ["inspect", "grant", "revoke", "restore"], required: ["path"] },
};
const PROTECTED_SERVICES = new Set(["rpcss", "wininit", "lsass", "samss", "eventlog", "cryptsvc", "trustedinstaller"]);
const ACTION_REQUIRED: Partial<Record<ToolCall["name"], Record<string, readonly string[]>>> = {
  win_dotnet: { discover: [], inspect: ["project"], restore: ["project"], build: ["project"], test: ["project"] },
  win_msbuild: { discover: [], sdk: [], build: ["solution"] },
  win_nuget: { sources: [], restore: ["project"], list: ["project"], vulnerable: ["project"] },
  win_winget: { search: ["query"], show: ["package_id"], install: ["package_id"], upgrade: ["package_id"] },
  win_registry: { read: ["name"], query: [], write: ["name", "value", "value_type"] },
  win_acl: { inspect: [], grant: ["identity", "rights"], revoke: ["identity"], restore: ["sddl"] },
};

const b64 = (value: unknown) => Buffer.from(String(value ?? ""), "utf8").toString("base64");
const ps = (value: unknown) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(value)}'))`;
const arg = (value: unknown) => `'${String(value ?? "").replaceAll("'", "''")}'`;

export function validateStructuredCall(call: ToolCall): string | null {
  const shape = SHAPES[call.name]; if (!shape) return null;
  const action = String(call.arguments.action ?? "");
  if (!shape.actions.includes(action)) return `invalid_${call.name}_action`;
  for (const field of shape.required ?? []) if (!String(call.arguments[field] ?? "").trim()) return `${field}_required`;
  for (const field of ACTION_REQUIRED[call.name]?.[action] ?? []) {
    if (!String(call.arguments[field] ?? "").trim()) return `${field}_required_for_${action}`;
  }
  if (call.name === "win_eventlog") {
    const max = Number(call.arguments.max_events ?? 100); const since = Number(call.arguments.since_minutes ?? 60);
    if (!Number.isInteger(max) || max < 1 || max > 500) return "max_events_must_be_1_to_500";
    if (!Number.isInteger(since) || since < 1 || since > 43_200) return "since_minutes_must_be_1_to_43200";
  }
  return null;
}

export function structuredAssessment(call: ToolCall, cwd: string): PolicyAssessment | null {
  if (!SHAPES[call.name]) return null;
  const action = String(call.arguments.action ?? "");
  const targets = ["path", "project", "solution", "package_id", "name"].map((key) => call.arguments[key]).filter(Boolean).map(String);
  const fingerprint = createHash("sha256").update(JSON.stringify({ name: call.name, arguments: call.arguments, cwd })).digest("hex");
  const mutation =
    (call.name === "win_dotnet" && ["restore", "build", "test"].includes(action)) ||
    (call.name === "win_msbuild" && action === "build") || (call.name === "win_nuget" && action === "restore") ||
    (call.name === "win_winget" && ["install", "upgrade"].includes(action)) ||
    (call.name === "win_service" && action !== "query") || (call.name === "win_registry" && action === "write") ||
    (call.name === "win_acl" && action !== "inspect");
  if (call.name === "win_service" && action !== "query" && PROTECTED_SERVICES.has(String(call.arguments.name).toLowerCase())) {
    return { decision: "block", risk: "blocked", reasons: ["Protected Windows service mutation is blocked."], targets, protectedTargets: targets, fingerprint };
  }
  if (call.name === "win_registry" && action === "write") {
    const hive = String(call.arguments.hive).toUpperCase(); const path = String(call.arguments.path);
    if (hive !== "HKCU" || !/^Software\\WinYOLO(?:\\|$)/i.test(path)) {
      return { decision: "block", risk: "blocked", reasons: ["Registry writes are limited to HKCU\\Software\\WinYOLO."], targets, protectedTargets: targets, fingerprint };
    }
  }
  const high = (call.name === "win_winget" && mutation) || (call.name === "win_service" && mutation) || (call.name === "win_acl" && mutation);
  return {
    decision: high ? "confirm" : "allow", risk: high ? "high" : mutation ? "medium" : "low",
    reasons: [high ? "Typed system mutation requires exact local approval." : mutation ? "Typed workspace mutation is bounded to the declared target." : "Read-only structured Windows operation."],
    targets, protectedTargets: high ? targets : [], fingerprint,
    ...(high ? { confirmationPhrase: `CONFIRM ${fingerprint.slice(0, 8).toUpperCase()}` } : {}),
  };
}

function toolArgs(call: ToolCall, cwd: string): { script: string; cwd: string } {
  const a = call.arguments; const action = String(a.action); const target = String(a.path ?? a.project ?? a.solution ?? cwd);
  if (call.name === "win_path") {
    const depth = Math.min(Math.max(Number(a.max_depth ?? 8), 1), 32);
    const script = action === "inspect"
      ? `$p=[IO.Path]::GetFullPath(${ps(target)});$x=if($p.StartsWith('\\')){'\\?\\UNC\\'+$p.TrimStart('\\')}else{'\\?\\'+$p};$i=Get-Item -LiteralPath $x -Force;[pscustomobject]@{Canonical=$p;FinalTarget=$i.Target;Attributes=$i.Attributes.ToString();IsReparsePoint=[bool]($i.Attributes -band [IO.FileAttributes]::ReparsePoint);LinkType=$i.LinkType;PSProvider=$i.PSProvider.Name;Length=$i.Length;ExtendedPath=$x}|ConvertTo-Json -Compress`
      : `$root=[IO.Path]::GetFullPath(${ps(target)});$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase);$out=[Collections.Generic.List[object]]::new();function Walk([string]$p,[int]$d){if($d -gt ${depth}){return};$full=[IO.Path]::GetFullPath($p);if(-not $seen.Add($full)){return};$x=if($full.StartsWith('\\')){'\\?\\UNC\\'+$full.TrimStart('\\')}else{'\\?\\'+$full};foreach($i in Get-ChildItem -LiteralPath $x -Force){$reparse=[bool]($i.Attributes -band [IO.FileAttributes]::ReparsePoint);$out.Add([pscustomobject]@{Canonical=$i.FullName;Attributes=$i.Attributes.ToString();IsReparsePoint=$reparse;LinkType=$i.LinkType;FinalTarget=$i.Target});if($i.PSIsContainer -and -not $reparse){Walk $i.FullName ($d+1)}}};Walk $root 0;$out|ConvertTo-Json -Compress`;
    return { script, cwd: resolve(cwd) };
  }
  if (call.name === "win_dotnet") {
    const configuration = arg(a.configuration ?? "Debug");
    const commands: Record<string, string> = {
      discover: "dotnet --info", inspect: `dotnet sln ${arg(target)} list`, restore: `dotnet restore ${arg(target)} --nologo`,
      build: `dotnet build ${arg(target)} --nologo --configuration ${configuration}`, test: `dotnet test ${arg(target)} --nologo --configuration ${configuration}`,
    }; return { script: commands[action]!, cwd: resolve(cwd) };
  }
  if (call.name === "win_msbuild") {
    if (action === "discover") return { script: "$v=& \"${env:ProgramFiles(x86)}\\Microsoft Visual Studio\\Installer\\vswhere.exe\" -latest -products * -requires Microsoft.Component.MSBuild -find MSBuild\\**\\Bin\\MSBuild.exe;$v|ConvertTo-Json -Compress", cwd: resolve(cwd) };
    if (action === "sdk") return { script: "Get-ChildItem \"${env:ProgramFiles(x86)}\\Windows Kits\\10\\bin\" -Directory|Sort-Object Name -Descending|Select-Object -ExpandProperty Name|ConvertTo-Json -Compress", cwd: resolve(cwd) };
    return { script: '$m=& "${env:ProgramFiles(x86)}\\Microsoft Visual Studio\\Installer\\vswhere.exe" -latest -products * -requires Microsoft.Component.MSBuild -find MSBuild\\**\\Bin\\MSBuild.exe|Select-Object -First 1;& $m ' + `${arg(target)} /m /restore /p:Configuration=${arg(a.configuration ?? "Debug")} /nologo`, cwd: resolve(cwd) };
  }
  if (call.name === "win_nuget") {
    const commands: Record<string, string> = { sources: "dotnet nuget list source --format detailed", restore: `dotnet restore ${arg(target)} --nologo`, list: `dotnet list ${arg(target)} package`, vulnerable: `dotnet list ${arg(target)} package --vulnerable --include-transitive` };
    return { script: commands[action]!, cwd: resolve(cwd) };
  }
  if (call.name === "win_winget") {
    const id = arg(a.package_id ?? a.query); const version = a.exact_version ? ` --version ${arg(a.exact_version)}` : "";
    const commands: Record<string, string> = { search: `winget search --query ${id} --accept-source-agreements`, show: `winget show --id ${id} --exact --accept-source-agreements`, install: `winget install --id ${id} --exact${version} --accept-source-agreements --accept-package-agreements --disable-interactivity`, upgrade: `winget upgrade --id ${id} --exact${version} --accept-source-agreements --accept-package-agreements --disable-interactivity` };
    return { script: commands[action]!, cwd: resolve(cwd) };
  }
  if (call.name === "win_service") {
    const name = ps(a.name); const mutate = (verb: string) => `$n=${name};$before=Get-Service -Name $n;${verb}-Service -Name $n;$after=Get-Service -Name $n;[pscustomobject]@{Name=$n;Before=$before.Status.ToString();After=$after.Status.ToString();StartType=$after.StartType.ToString()}|ConvertTo-Json -Compress`;
    const commands: Record<string, string> = { query: `Get-Service -Name (${name})|Select-Object Name,DisplayName,Status,StartType|ConvertTo-Json -Compress`, start: mutate("Start"), stop: mutate("Stop"), restart: mutate("Restart") };
    return { script: commands[action]!, cwd: resolve(cwd) };
  }
  if (call.name === "win_registry") {
    const hive = String(a.hive).toUpperCase(); const prefix = hive === "HKCU" ? "HKCU:" : hive === "HKLM" ? "HKLM:" : "";
    const key = `${prefix}\\${String(a.path).replace(/^\\+/, "")}`; const name = ps(a.name ?? "");
    if (action === "query") return { script: `Get-ChildItem -LiteralPath (${ps(key)})|Select-Object Name,Property|ConvertTo-Json -Compress`, cwd: resolve(cwd) };
    if (action === "read") return { script: `Get-ItemPropertyValue -LiteralPath (${ps(key)}) -Name (${name})|ConvertTo-Json -Compress`, cwd: resolve(cwd) };
    return { script: `$k=${ps(key)};$n=${name};$before=try{Get-ItemPropertyValue -LiteralPath $k -Name $n -ErrorAction Stop}catch{$null};New-Item -Path $k -Force|Out-Null;New-ItemProperty -LiteralPath $k -Name $n -Value (${ps(a.value)}) -PropertyType ${arg(a.value_type ?? "String")} -Force|Out-Null;$after=Get-ItemPropertyValue -LiteralPath $k -Name $n;[pscustomobject]@{Path=$k;Name=$n;Before=$before;After=$after;RevertValue=$before}|ConvertTo-Json -Compress`, cwd: resolve(cwd) };
  }
  if (call.name === "win_eventlog") {
    const provider = String(a.provider ?? ""); const level = Number(a.level ?? 0); const eventId = Number(a.event_id ?? 0); const max = Number(a.max_events ?? 100); const since = Number(a.since_minutes ?? 60);
    return { script: `$f=@{LogName=${arg(a.log_name ?? "Application")};StartTime=(Get-Date).AddMinutes(-${since})}${provider ? `;$f.ProviderName=${arg(provider)}` : ""}${level ? `;$f.Level=${level}` : ""}${eventId ? `;$f.Id=${eventId}` : ""};Get-WinEvent -FilterHashtable $f -MaxEvents ${max}|Select-Object TimeCreated,Id,LevelDisplayName,ProviderName,Message|ConvertTo-Json -Compress`, cwd: resolve(cwd) };
  }
  const identity = ps(a.identity ?? ""); const rights = ps(a.rights ?? "ReadAndExecute");
  const acl: Record<string, string> = { inspect: `Get-Acl -LiteralPath (${ps(target)})|Select-Object Path,Owner,AccessToString,Sddl|ConvertTo-Json -Compress`, grant: `$p=${ps(target)};$acl=Get-Acl -LiteralPath $p;$before=$acl.Sddl;$r=New-Object Security.AccessControl.FileSystemAccessRule((${identity}),(${rights}),'ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($r);Set-Acl -LiteralPath $p -AclObject $acl;$after=Get-Acl -LiteralPath $p;[pscustomobject]@{Path=$p;BeforeSddl=$before;AfterSddl=$after.Sddl;RevertSddl=$before}|ConvertTo-Json -Compress`, revoke: `$p=${ps(target)};$acl=Get-Acl -LiteralPath $p;$before=$acl.Sddl;$acl.Access|Where-Object IdentityReference -eq (${identity})|ForEach-Object{$acl.RemoveAccessRuleSpecific($_)};Set-Acl -LiteralPath $p -AclObject $acl;$after=Get-Acl -LiteralPath $p;[pscustomobject]@{Path=$p;BeforeSddl=$before;AfterSddl=$after.Sddl;RevertSddl=$before}|ConvertTo-Json -Compress`, restore: `$p=${ps(target)};$acl=Get-Acl -LiteralPath $p;$before=$acl.Sddl;$acl.SetSecurityDescriptorSddlForm((${ps(a.sddl)}));Set-Acl -LiteralPath $p -AclObject $acl;$after=Get-Acl -LiteralPath $p;[pscustomobject]@{Path=$p;BeforeSddl=$before;AfterSddl=$after.Sddl;RevertSddl=$before}|ConvertTo-Json -Compress` };
  return { script: acl[action]!, cwd: resolve(cwd) };
}

export function structuredScript(call: ToolCall, cwd: string): { script: string; cwd: string } | null {
  return SHAPES[call.name] ? toolArgs(call, cwd) : null;
}

// Codex strict tools require every declared property to be required. Fields that do
// not apply to the selected action are nullable; validateStructuredCall enforces the
// action-specific non-null requirements before policy or execution runs.
const schema = (name: ToolCall["name"], description: string, actions: readonly string[], properties: Record<string, unknown>, required: string[]): AgentToolDefinition => ({ type: "function", name, description, parameters: { type: "object", properties: { action: { type: "string", enum: actions }, ...properties }, required: ["action", ...required], additionalProperties: false }, strict: true });
export const WINDOWS_STRUCTURED_TOOLS: AgentToolDefinition[] = [
  schema("win_path", "Resolve and inspect Windows paths, links, junctions, reparse targets, and bounded traversal.", ["inspect", "traverse"], { path: { type: "string" }, max_depth: { type: ["number", "null"] } }, ["path", "max_depth"]),
  schema("win_dotnet", "Discover, inspect, restore, build, or test a .NET project or solution.", ["discover", "inspect", "restore", "build", "test"], { project: { type: ["string", "null"] }, configuration: { type: ["string", "null"] } }, ["project", "configuration"]),
  schema("win_msbuild", "Discover Visual Studio MSBuild, build a solution, or report Windows SDK versions.", ["discover", "build", "sdk"], { solution: { type: ["string", "null"] }, configuration: { type: ["string", "null"] } }, ["solution", "configuration"]),
  schema("win_nuget", "Inspect NuGet sources, restore, list packages, or report vulnerable packages.", ["sources", "restore", "list", "vulnerable"], { project: { type: ["string", "null"] } }, ["project"]),
  schema("win_winget", "Search, inspect, install, or upgrade an exact WinGet package.", ["search", "show", "install", "upgrade"], { query: { type: ["string", "null"] }, package_id: { type: ["string", "null"] }, exact_version: { type: ["string", "null"] } }, ["query", "package_id", "exact_version"]),
  schema("win_service", "Query or mutate a named Windows service under protected-service policy.", ["query", "start", "stop", "restart"], { name: { type: "string" } }, ["name"]),
  schema("win_registry", "Read/query registry values or write only under HKCU Software WinYOLO.", ["read", "query", "write"], { hive: { type: "string", enum: ["HKCU", "HKLM"] }, path: { type: "string" }, name: { type: ["string", "null"] }, value: { type: ["string", "null"] }, value_type: { type: ["string", "null"], enum: [null, "String", "ExpandString", "Binary", "DWord", "MultiString", "QWord"] } }, ["hive", "path", "name", "value", "value_type"]),
  schema("win_eventlog", "Run a bounded Windows Event Log query by provider, level, event ID, and time.", ["query"], { log_name: { type: "string" }, provider: { type: ["string", "null"] }, level: { type: ["number", "null"] }, event_id: { type: ["number", "null"] }, since_minutes: { type: "number" }, max_events: { type: "number" } }, ["log_name", "provider", "level", "event_id", "since_minutes", "max_events"]),
  schema("win_acl", "Inspect NTFS ACLs or apply reversible grants, revocations, and SDDL restore.", ["inspect", "grant", "revoke", "restore"], { path: { type: "string" }, identity: { type: ["string", "null"] }, rights: { type: ["string", "null"] }, sddl: { type: ["string", "null"] } }, ["path", "identity", "rights", "sddl"]),
];
