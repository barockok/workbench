import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { collectInventory } from "./inventory";

const root = join(__dirname, "..", "..");

describe("collectInventory", () => {
  it("lists every plugin directory with a manifest, with its logo inlined and a real tool count", async () => {
    const inv = await collectInventory(root);
    expect(inv.totals.integrations).toBeGreaterThanOrEqual(16);
    expect(inv.totals.tools).toBeGreaterThan(100);
    expect(inv.integrations.find((i) => i.name === "httpbin-cookie")).toBeUndefined();
    for (const i of inv.integrations) {
      expect(i.displayName.length).toBeGreaterThan(0);
      expect(i.logoSvg.startsWith("<svg")).toBe(true);
      expect(i.toolCount).toBeGreaterThan(0);
    }
    expect(inv.integrations.reduce((n, i) => n + i.toolCount, 0)).toBe(inv.totals.tools);
  }, 60_000);

  it("reads the meta-tool count from the server's definition, not a constant", async () => {
    const inv = await collectInventory(root);
    expect(inv.totals.metaTools).toBe(9);
  }, 60_000);

  it("never emits anything from the PII guard list", async () => {
    const inv = await collectInventory(root);
    expect(JSON.stringify(inv)).not.toMatch(/@(icloud|gmail)\.com/i);
  }, 60_000);
});
