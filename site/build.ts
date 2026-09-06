import { mkdirSync, cpSync, copyFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectInventory } from "./lib/inventory";
import { renderPage, fillReplay, type ReplayStep } from "./lib/template";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), out = join(here, "_site");
const brandDist = join(root, "packages", "brand", "dist");
if (!existsSync(join(brandDist, "index.js"))) throw new Error("site: build @a-workbench/brand first");

mkdirSync(join(out, "brand"), { recursive: true }); mkdirSync(join(out, "shots"), { recursive: true });
cpSync(brandDist, join(out, "brand"), { recursive: true });
for (const f of ["favicon.svg", "apple-touch-180.png", "og-1200x630.png"]) copyFileSync(join(brandDist, f), join(out, f));
copyFileSync(join(root, "packages", "shared", "styles", "tokens.css"), join(out, "tokens.css"));
for (const f of ["site.css", "site.js"]) copyFileSync(join(here, "assets", f), join(out, f));
for (const f of ["apps.png", "connect.png", "result.png"]) {
  const src = join(here, "assets", "shots", f);
  if (!existsSync(src)) throw new Error(`site: missing screenshot assets/shots/${f} — run \`npm run shots -w @a-workbench/site\``);
  copyFileSync(src, join(out, "shots", f));
}

const inventory = await collectInventory(root);
if (inventory.totals.integrations === 0 || inventory.totals.tools === 0 || inventory.totals.metaTools === 0) throw new Error("site: a count is zero");
const replay = JSON.parse(readFileSync(join(here, "data", "replay.json"), "utf8")) as ReplayStep[];
const html = renderPage({
  inventory, replay: fillReplay(replay, inventory.totals),
  docsUrl: process.env.SITE_DOCS_URL ?? "https://barockok.github.io/workbench/",
  repoUrl: "https://github.com/barockok/workbench",
  image: (process.env.URL ?? "") + "/og-1200x630.png",   // Netlify sets URL to the deploy's origin
  shots: { apps: "shots/apps.png", connect: "shots/connect.png", result: "shots/result.png" },
});
if (/@(icloud|gmail)\.com/i.test(html)) throw new Error("site: output matches the PII guard");
writeFileSync(join(out, "index.html"), html);
console.log(`site: ${inventory.totals.integrations} integrations, ${inventory.totals.tools} tools, ${inventory.totals.metaTools} meta-tools → _site/index.html`);
