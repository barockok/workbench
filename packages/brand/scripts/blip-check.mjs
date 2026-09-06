// Samples how much of the canvas is painted every 100ms through the entrance
// hand-off. A blink shows up as a dip between adjacent samples. Requires
// `npm run build -w @a-workbench/brand` first (imports ../dist).
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Chromium refuses to fetch an ES module import over file:// as a CORS
// failure ("origin 'null'") unless local file access is explicitly allowed.
const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
await page.goto(pathToFileURL(join(here, "swarm-page.html")).href);
await page.waitForFunction(() => window.swarm?.state().ready);
const t0 = Date.now(), rows = [];
while (Date.now() - t0 < 6500) {
  const n = await page.evaluate(() => { const c = document.getElementById("swarm"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 28) if (d[i] > 40) n++; return n; });
  rows.push({ t: (Date.now() - t0) / 1000, n }); await page.waitForTimeout(100);
}
await browser.close();
let worst = 0;
for (let i = 1; i < rows.length; i++) if (rows[i - 1].t >= 3.5) worst = Math.max(worst, (rows[i - 1].n - rows[i].n) / rows[i - 1].n);
console.log(rows.map((r) => `${r.t.toFixed(1)}:${r.n}`).join("  "));
console.log(`worst dip after 3.5s: ${(worst * 100).toFixed(1)}%`);
process.exit(worst > 0.15 ? 1 : 0);
