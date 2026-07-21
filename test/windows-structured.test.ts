import { describe, expect, test } from "bun:test";
import { TOOL_DEFINITIONS } from "../src/tools.ts";
import { structuredAssessment, structuredScript, validateStructuredCall } from "../src/windows-structured.ts";
import type { ToolCall } from "../src/types.ts";

const call = (name: ToolCall["name"], args: Record<string, unknown>): ToolCall => ({ callId: "test", name, arguments: args });
describe("structured Windows capabilities", () => {
  test("all nine tools expose strict closed schemas", () => {
    const tools = TOOL_DEFINITIONS.filter((tool) => tool.name.startsWith("win_")).slice(4);
    expect(tools.map((tool) => tool.name)).toEqual(["win_path", "win_dotnet", "win_msbuild", "win_nuget", "win_winget", "win_service", "win_registry", "win_eventlog", "win_acl"]);
    for (const tool of tools) { expect(tool.strict).toBe(true); expect(tool.parameters.additionalProperties).toBe(false); }
  });
  test("validates bounded events and exact package mutations", () => {
    expect(validateStructuredCall(call("win_eventlog", { action: "query", max_events: 501, since_minutes: 60 }))).toContain("max_events");
    expect(validateStructuredCall(call("win_winget", { action: "install", package_id: null }))).toBe("package_id_required_for_install");
    expect(validateStructuredCall(call("win_winget", { action: "search", query: null }))).toBe("query_required_for_search");
    expect(validateStructuredCall(call("win_dotnet", { action: "discover", project: null, configuration: null }))).toBeNull();
    expect(validateStructuredCall(call("win_dotnet", { action: "build", project: null, configuration: null }))).toBe("project_required_for_build");
    expect(validateStructuredCall(call("win_acl", { action: "restore", path: "C:\\x", sddl: null }))).toBe("sddl_required_for_restore");
  });
  test("blocks protected services and non-allowlisted registry writes", () => {
    expect(structuredAssessment(call("win_service", { action: "stop", name: "RpcSs" }), "C:\\repo")?.decision).toBe("block");
    expect(structuredAssessment(call("win_registry", { action: "write", hive: "HKLM", path: "Software\\X" }), "C:\\repo")?.decision).toBe("block");
    expect(structuredAssessment(call("win_registry", { action: "write", hive: "HKCU", path: "Software\\WinYOLO\\Fixture" }), "C:\\repo")?.decision).toBe("allow");
  });
  test("encodes path input rather than interpolating executable syntax", () => {
    const built = structuredScript(call("win_path", { action: "inspect", path: "C:\\repo';Remove-Item C:\\" }), "C:\\repo")!;
    expect(built.script).not.toContain("Remove-Item"); expect(built.script).toContain("FromBase64String");
  });
});
