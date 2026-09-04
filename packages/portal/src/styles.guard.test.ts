import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");

// Rules the geometry decision depends on. A future edit that reintroduces a
// pill button or a drop shadow on a static surface fails here rather than
// quietly drifting the whole interface back.
describe("portal stylesheet geometry", () => {
  it("uses a full radius only on the toggle, which is a capsule by definition", () => {
    const users = css
      .split("}")
      .filter((block) => block.includes("--radius-full"))
      .map((block) => block.split("{")[0].trim());
    expect(users.length).toBeGreaterThan(0);
    for (const selector of users) {
      expect(selector).toMatch(/ui-toggle/);
    }
  });

  it("casts a shadow only on genuinely overlaid surfaces", () => {
    const users = css
      .split("}")
      .filter((block) => /box-shadow\s*:/.test(block))
      .map((block) => block.split("{")[0].trim());
    expect(users.length).toBeGreaterThan(0);
    for (const selector of users) {
      // The modal and the bottom sheet are the only things that genuinely
      // float above the page. The sheet's class is `ui-sheet`, not
      // `ui-bottom-sheet` — the component is named BottomSheet but its CSS
      // is not.
      expect(selector).toMatch(/ui-modal|ui-sheet/);
    }
  });

  it("carries no leftover ornament rules", () => {
    for (const dead of [".eyebrow", ".headline", ".card-index", ".card-top", ".filter-chip", ".blinker", ".ticker"]) {
      expect(css).not.toContain(dead);
    }
  });
});
