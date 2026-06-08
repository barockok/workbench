import { describe, it, expect } from "vitest";
import { userProfileDir, profilesBaseDir, activeProfiles } from "../src/auth/profile-chromium";

describe("profile-chromium dirs", () => {
  it("derives a per-user dir under the base", () => {
    const dir = userProfileDir("user-abc");
    expect(dir.startsWith(profilesBaseDir())).toBe(true);
    expect(dir.endsWith("user-abc")).toBe(true);
  });
  it("sanitizes path-traversal characters in the userId", () => {
    const dir = userProfileDir("../../etc/passwd");
    expect(dir).not.toContain("..");
    expect(dir.startsWith(profilesBaseDir())).toBe(true);
  });
  it("exports a shared activeProfiles lock set", () => {
    expect(activeProfiles instanceof Set).toBe(true);
  });
});
