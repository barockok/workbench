import { describe, it, expect } from "vitest";
import path from "node:path";
import { isValidJotName, safeRelPath, resolveInside, MANIFEST } from "../../src/jots/paths";

describe("jots/paths", () => {
  it("validates jot names", () => {
    expect(isValidJotName("report")).toBe(true);
    expect(isValidJotName("a-b-9")).toBe(true);
    expect(isValidJotName("-bad")).toBe(false);
    expect(isValidJotName("Bad")).toBe(false);
    expect(isValidJotName("has space")).toBe(false);
    expect(isValidJotName("a".repeat(65))).toBe(false);
  });

  it("accepts safe relative deploy paths", () => {
    expect(safeRelPath("index.html")).toBe("index.html");
    expect(safeRelPath("assets/app.js")).toBe("assets/app.js");
  });

  it("rejects unsafe deploy paths", () => {
    expect(safeRelPath("../escape")).toBeNull();
    expect(safeRelPath("/abs")).toBeNull();
    expect(safeRelPath("a/../../b")).toBeNull();
    expect(safeRelPath(MANIFEST)).toBeNull();
    expect(safeRelPath("sub/jot.json")).toBeNull();
    expect(safeRelPath("JOT.JSON")).toBeNull();
    expect(safeRelPath("sub/JOT.JSON")).toBeNull();
    expect(safeRelPath("foo\x00/../bar")).toBeNull();
    expect(safeRelPath("")).toBeNull();
  });

  it("resolves serve paths inside the jot dir, blocking escape and the manifest", () => {
    const dir = "/srv/jots/report";
    expect(resolveInside(dir, "")).toBe(path.join(dir, "index.html"));
    expect(resolveInside(dir, "a/")).toBe(path.join(dir, "a/index.html"));
    expect(resolveInside(dir, "app.js")).toBe(path.join(dir, "app.js"));
    expect(resolveInside(dir, "../../etc/passwd")).toBeNull();
    expect(resolveInside(dir, MANIFEST)).toBeNull();
    expect(resolveInside(dir, "JOT.JSON")).toBeNull();
    expect(resolveInside(dir, "/abs/path")).toBeNull();
  });
});
