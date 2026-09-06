import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const dist = join(root, "dist");
const PNG = Boolean(process.env.BRAND_TEST_PNG);

describe("build.mjs", () => {
  beforeAll(() => {
    execFileSync("npx", ["tsc", "-p", root], { stdio: "inherit" });
    // A browser round-trip costs ~15s and needs `playwright install chromium`,
    // so the unit suite skips the PNGs unless BRAND_TEST_PNG asks for them. CI
    // sets it, so the PNG path is still exercised on every push.
    execFileSync("node", [join(root, "build.mjs")], {
      stdio: "inherit",
      env: { ...process.env, ...(PNG ? {} : { BRAND_SKIP_PNG: "1" }) },
    });
  }, 120_000);

  it.each(["mark.svg", "mark-small.svg", "mark-knockout.svg", "favicon.svg", "lockup-light.svg", "lockup-dark.svg"])(
    "writes %s", (f) => { expect(existsSync(join(dist, f))).toBe(true); },
  );

  it("favicon is the small variant with a fixed accent, since a tab has no CSS", () => {
    const svg = readFileSync(join(dist, "favicon.svg"), "utf8");
    expect(svg).toContain('stroke="#853291"');
    expect(svg).not.toContain("currentColor");
    expect(svg).not.toContain("<rect");
  });

  it("lockups carry the wordmark as text next to the mark", () => {
    const svg = readFileSync(join(dist, "lockup-light.svg"), "utf8");
    expect(svg).toContain(">workbench<");
  });

  it.skipIf(!PNG).each(["favicon-32.png", "apple-touch-180.png", "og-1200x630.png"])(
    "renders %s", (f) => { expect(statSync(join(dist, f)).size).toBeGreaterThan(500); },
  );
});
