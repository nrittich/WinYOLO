import { describe, expect, test } from "bun:test";
import { renderPermissionProfiles } from "../src/permission-profiles.ts";

describe("Codex permission profiles", () => {
  test("renders Safe and constrained YOLO without full access", () => {
    const profiles = renderPermissionProfiles();
    expect(profiles).toContain("[profiles.winyolo-safe]"); expect(profiles).toContain("[profiles.winyolo-yolo]");
    expect(profiles).toContain('approval_policy = "never"'); expect(profiles).toContain("network_access = false"); expect(profiles).not.toContain("danger-full-access");
  });
  test("keeps only syntactically valid proxy domains", () => {
    const profiles = renderPermissionProfiles({ allowedDomains: ["api.example.com", "bad/domain", "api.example.com"] });
    expect(profiles).toContain('allowed_domains = ["api.example.com"]'); expect(profiles).not.toContain("bad/domain");
  });
});
