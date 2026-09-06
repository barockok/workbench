import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), site = join(here, ".."), out = join(site, "_site");
execFileSync("node", [join(site, "build.mjs")], { stdio: "inherit" });
const html = readFileSync(join(out, "index.html"), "utf8");

test("favicon is a file copied from the brand package, not a data URL", () => {
  assert.match(html, /<link rel="icon" href="[^"]*favicon\.svg" type="image\/svg\+xml">/);
  assert.ok(existsSync(join(out, "assets", "favicon.svg")));
  assert.doesNotMatch(html, /data:image\/svg\+xml/);
});
test("topbar mark is the Node W", () => {
  assert.match(html, /class="brand-mark"[^>]*>\s*<svg[^>]*>.*M5 8 L10 24 L16 12 L22 24 L27 8/s);
  assert.doesNotMatch(html, /class="brand-mark"[^>]*>w</);
});
test("pages carry the OG image", () => {
  assert.match(html, /<meta property="og:image" content="[^"]*og-1200x630\.png">/);
});
