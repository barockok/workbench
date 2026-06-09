// Browser-use surfaced as a first-class integration in the portal. It is NOT a
// registry plugin — the browser_* tools are meta-tools handled directly by the
// MCP server. This module only provides the synthetic descriptor the read
// endpoints inject so the capability shows up as a normal integration card.
import { metaTools } from "../mcp/meta-tools";

export const BROWSER_INTEGRATION_NAME = "browser";

// The browser_* meta-tools, as plain {name, description} for the card's tool list.
function browserTools(): { name: string; description: string }[] {
  return metaTools
    .filter((t) => t.name.startsWith("browser_"))
    .map((t) => ({ name: t.name, description: t.description }));
}

export function browserSummary() {
  return {
    name: BROWSER_INTEGRATION_NAME,
    version: "1.0.0",
    displayName: "Browser",
    description:
      "Built-in headless browser the agent drives directly (navigate, click, type, screenshot). Open a live view to take over by hand.",
    categories: ["browser"],
    logo: undefined as string | undefined,
    toolCount: browserTools().length,
    configured: true,
  };
}

export function browserDetail() {
  return {
    ...browserSummary(),
    authType: "none" as const,
    tools: browserTools(),
  };
}
