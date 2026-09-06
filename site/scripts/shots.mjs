// Captures the three portal screenshots for the landing page against the portal
// dev server with every /api call mocked, so no login and no real data.
// Usage: (in one shell) npm run dev -w @a-workbench/portal ; (in another) npm run shots -w @a-workbench/site
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectInventory } from "../lib/inventory.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "assets", "shots");
const root = join(here, "..", "..");
mkdirSync(out, { recursive: true });

const fx = (f) => JSON.parse(readFileSync(join(here, "fixtures", f), "utf8"));
const inv = await collectInventory(root);

// Matches the shape of GET /api/integrations (packages/server/src/api/routes.ts):
// `{ integrations: IntegrationSummary[] }`, with `logo` pointing at the
// per-integration logo endpoint the same way `resolveLogo()` does server-side.
const integrations = inv.integrations.map((i) => ({
  name: i.name,
  version: "1.0.0",
  displayName: i.displayName,
  description: i.description,
  logo: `/api/integrations/${i.name}/logo`,
  toolCount: i.toolCount,
  configured: true,
  authType: "oauth2",
}));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.addInitScript(() => localStorage.setItem("awb_token", "tok-abc"));

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  const p = url.pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (p === "/api/auth/me") return json(fx("me.json"));
  if (p === "/api/integrations") return json({ integrations });
  if (p.startsWith("/api/integrations/") && p.endsWith("/logo")) {
    const name = p.split("/")[3];
    const i = inv.integrations.find((x) => x.name === name);
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: i?.logoSvg ?? "" });
  }
  if (p === "/api/connections") return json(fx("connections.json"));
  if (p === "/api/stats") return json({ stored: true, window_days: 1, tool_calls: 128, success_rate: 0.98, most_used_integration: "github" });
  if (p === "/api/agents") return json({ agents: [] });
  if (p === "/api/activity") return json({ stored: true, events: [], next_cursor: null });
  return json({}, 200);
});

const base = process.env.PORTAL_URL ?? "http://localhost:3000";

// Apps: the grid of connectable integrations, inside the authenticated shell.
await page.goto(`${base}/apps`);
await page.waitForSelector("text=GitHub");
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "apps.png") });

// Connect: the human-approval card an agent's connect link lands on
// (packages/portal/src/pages/Connect.tsx), reached with `?t=<jwt>`.
await page.goto(`${base}/connect/google-sheets?t=tok-connect-abc`);
await page.waitForSelector("text=Connect Google Sheets?");
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "connect.png") });

// Result: where a finished connect lands (packages/portal/src/pages/ConnectResult.tsx).
await page.goto(`${base}/connected/google-sheets?status=ok`);
await page.waitForSelector("text=Connected");
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "result.png") });

await browser.close();
console.log("site: wrote apps.png connect.png result.png to assets/shots/");
