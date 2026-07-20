import { describe, expect, test } from "bun:test";
import { assessToolCall, canonicalWindowsPath, extractWindowsPaths, isProtectedPath } from "../src/policy.ts";
import type { ToolCall } from "../src/types.ts";

const env = {
  SystemDrive: "C:",
  SystemRoot: "C:\\Windows",
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
  ProgramData: "C:\\ProgramData",
};

function shell(script: string): ToolCall {
  return {
    callId: "test",
    name: "win_shell",
    arguments: { shell: "powershell", script, cwd: null, timeout_ms: null, reason: "test" },
  };
}

describe("Windows path policy", () => {
  test("normalizes case, separators, and traversal", () => {
    expect(canonicalWindowsPath("C:/WINDOWS/System32/../Temp/")).toBe("c:\\windows\\temp");
  });

  test("protects roots without sibling prefix confusion", () => {
    expect(isProtectedPath("C:\\Windows\\System32", undefined, "C:\\")).toBe(true);
    expect(isProtectedPath("C:\\Windows-old\\file.txt", undefined, "C:\\")).toBe(false);
  });

  test("extracts drive paths from PowerShell", () => {
    expect(extractWindowsPaths("Remove-Item 'C:\\Windows\\Temp\\x' -Force")[0]).toContain("C:\\Windows");
  });
});

describe("shell risk classification", () => {
  test("allows harmless native inspection", () => {
    expect(assessToolCall(shell("Get-Process | Select-Object -First 5"), "C:\\Work", env).decision).toBe("allow");
  });

  test("requires confirmation for protected deletion", () => {
    const result = assessToolCall(shell("Remove-Item 'C:\\Windows\\System32\\fixture' -Recurse -Force"), "C:\\Work", env);
    expect(result.decision).toBe("confirm");
    expect(result.risk).toBe("high");
    expect(result.protectedTargets.length).toBeGreaterThan(0);
    expect(result.confirmationPhrase).toMatch(/^CONFIRM [A-F0-9]{8}$/);
  });

  test("requires confirmation for unknown deletion target", () => {
    expect(assessToolCall(shell("Remove-Item $target -Recurse -Force"), "C:\\Work", env).decision).toBe("confirm");
  });

  test("requires confirmation for opaque destructive command", () => {
    expect(assessToolCall(shell("Invoke-Expression 'Remove-Item $target'"), "C:\\Work", env).decision).toBe("confirm");
  });

  test("blocks WSL and bash", () => {
    expect(assessToolCall(shell("wsl.exe uname -a"), "C:\\Work", env).decision).toBe("block");
    expect(assessToolCall(shell("bash -lc 'pwd'"), "C:\\Work", env).decision).toBe("block");
    expect(assessToolCall(shell("Get-ChildItem '\\\\wsl$\\Ubuntu'"), "C:\\Work", env).decision).toBe("block");
  });

  test("blocks UNC and device namespaces", () => {
    expect(assessToolCall(shell("Get-ChildItem '\\\\server\\share'"), "C:\\Work", env).decision).toBe("block");
    expect(assessToolCall(shell("Get-ChildItem '\\\\?\\GLOBALROOT\\Device'"), "C:\\Work", env).decision).toBe("block");
  });

  test("fingerprint binds arguments", () => {
    const a = assessToolCall(shell("Remove-Item $a"), "C:\\Work", env);
    const b = assessToolCall(shell("Remove-Item $b"), "C:\\Work", env);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe("structured tool policy", () => {
  test("safe workspace deletion is medium YOLO", () => {
    const call: ToolCall = { callId: "x", name: "win_filesystem", arguments: { action: "delete", path: "C:\\Work\\fixture", content: null, destination: null, recursive: true } };
    const result = assessToolCall(call, "C:\\Work", env);
    expect(result.decision).toBe("allow");
    expect(result.risk).toBe("medium");
  });

  test("protected structured write requires confirmation", () => {
    const call: ToolCall = { callId: "x", name: "win_filesystem", arguments: { action: "write", path: "C:\\ProgramData\\fixture", content: "x", destination: null, recursive: false } };
    expect(assessToolCall(call, "C:\\Work", env).decision).toBe("confirm");
  });
});
