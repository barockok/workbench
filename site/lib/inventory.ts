import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface IntegrationEntry { name: string; displayName: string; description: string; logoSvg: string; toolCount: number }
export interface Inventory { integrations: IntegrationEntry[]; totals: { integrations: number; tools: number; metaTools: number } }

// Same test the server's loader applies (packages/server/src/plugins/loader.ts
// isTool): a tool has a name, a handler function and a zod schema. Checking for
// `safeParse` avoids importing zod here and dodges dual-instance identity.
function isTool(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && typeof o.handler === "function" && typeof (o.inputSchema as { safeParse?: unknown })?.safeParse === "function";
}
function countTools(mod: Record<string, unknown>): number {
  const seen = new Set<string>();
  const visit = (c: unknown, depth = 0) => {
    if (typeof c !== "object" || c === null || depth > 2) return;
    for (const v of Object.values(c as Record<string, unknown>)) if (isTool(v)) seen.add((v as { name: string }).name);
    const o = c as Record<string, unknown>; visit(o.default, depth + 1); visit(o["module.exports"], depth + 1);
  };
  visit(mod);
  return seen.size;
}
const unwrap = (m: Record<string, unknown>) => (m.default && typeof m.default === "object" ? (m.default as Record<string, unknown>) : m);
// Strip a leading XML declaration (some vendor-exported SVGs carry one) so
// every logoSvg is embeddable inline, starting directly with `<svg`.
const stripXmlDecl = (svg: string) => svg.replace(/^﻿?\s*<\?xml[^>]*\?>\s*/, "").trim();

export async function collectInventory(repoRoot: string): Promise<Inventory> {
  const pluginsDir = join(repoRoot, "packages", "plugins");
  const integrations: IntegrationEntry[] = [];
  for (const dir of readdirSync(pluginsDir).sort()) {
    const base = join(pluginsDir, dir);
    if (!existsSync(join(base, "manifest.ts"))) continue;
    const manifest = unwrap(await import(pathToFileURL(join(base, "manifest.ts")).href)) as { name: string; displayName?: string; description?: string; logo?: string; categories?: string[] };
    if (manifest.categories?.includes("demo")) continue;
    const tools = (await import(pathToFileURL(join(base, "tools", "index.ts")).href)) as Record<string, unknown>;
    const logoPath = manifest.logo && !/^https?:/.test(manifest.logo) ? join(base, manifest.logo) : undefined;
    if (!logoPath || !existsSync(logoPath)) throw new Error(`site: plugin "${dir}" has no bundled logo — every integration on the site needs one`);
    integrations.push({
      name: manifest.name, displayName: manifest.displayName ?? manifest.name, description: manifest.description ?? "",
      logoSvg: stripXmlDecl(readFileSync(logoPath, "utf8")), toolCount: countTools(tools),
    });
  }
  const metaSrc = readFileSync(join(repoRoot, "packages", "server", "src", "mcp", "meta-tools.ts"), "utf8");
  const metaBlock = metaSrc.slice(metaSrc.indexOf("export const metaTools = ["), metaSrc.indexOf("] satisfies readonly MetaTool[];", metaSrc.indexOf("export const metaTools")));
  const metaTools = (metaBlock.match(/^\s*name: "[a-z_]+",$/gm) ?? []).length;
  if (metaTools === 0) throw new Error("site: could not count meta-tools from packages/server/src/mcp/meta-tools.ts");
  return { integrations, totals: { integrations: integrations.length, tools: integrations.reduce((n, i) => n + i.toolCount, 0), metaTools } };
}
