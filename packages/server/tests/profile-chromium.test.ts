import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  userProfileDir,
  profilesBaseDir,
  activeProfiles,
  clearStaleSingletonLocks,
} from "../src/auth/profile-chromium";

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

describe("clearStaleSingletonLocks", () => {
  it("removes a stale SingletonLock symlink left by a dead pod", () => {
    const dir = mkdtempSync(join(tmpdir(), "prof-"));
    try {
      // chromium writes the lock as a symlink encoding <hostname>-<pid>; the
      // target need not exist (and here points at a dead host).
      symlinkSync("dead-pod-k8f84-424", join(dir, "SingletonLock"));
      writeFileSync(join(dir, "SingletonCookie"), "x");
      writeFileSync(join(dir, "SingletonSocket"), "x");

      clearStaleSingletonLocks(dir);

      expect(existsSync(join(dir, "SingletonLock"))).toBe(false);
      expect(existsSync(join(dir, "SingletonCookie"))).toBe(false);
      expect(existsSync(join(dir, "SingletonSocket"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is a no-op on a clean profile dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "prof-"));
    try {
      mkdirSync(join(dir, "Default"), { recursive: true });
      expect(() => clearStaleSingletonLocks(dir)).not.toThrow();
      // real profile data is untouched
      expect(existsSync(join(dir, "Default"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
