/**
 * Standalone smoke test for the New Relic plugin — no portal / SSO / DB needed.
 *
 * It builds the same minimal ToolContext the server hands plugins (an apikey
 * ctx: ctx.http injects the `Api-Key` header, ctx.getConfig() carries region),
 * then runs the real plugin tool code against live NerdGraph.
 *
 * Usage:
 *   NEW_RELIC_API_KEY=NRAK-xxxx \
 *   NEW_RELIC_REGION=US \
 *   NEW_RELIC_ACCOUNT_ID=1234567 \
 *   npx tsx scripts/verify-newrelic.ts
 *
 *   # also create a throwaway alert policy (a real mutation):
 *   ... npx tsx scripts/verify-newrelic.ts --create
 */
import { createAlertPolicy } from "../../plugins/newrelic/tools/index";

const API_KEY = process.env.NEW_RELIC_API_KEY;
const REGION = (process.env.NEW_RELIC_REGION ?? "US").toUpperCase();
const ACCOUNT_ID = process.env.NEW_RELIC_ACCOUNT_ID
  ? Number(process.env.NEW_RELIC_ACCOUNT_ID)
  : undefined;

if (!API_KEY) {
  console.error("Set NEW_RELIC_API_KEY (the User API key, starts with NRAK-).");
  process.exit(1);
}

const ENDPOINT =
  REGION === "EU" ? "https://api.eu.newrelic.com/graphql" : "https://api.newrelic.com/graphql";

// Minimal apikey ToolContext — mirrors what packages/server/src/plugins/context.ts
// produces for an apikey integration.
const ctx = {
  getConfig: () => ({ region: REGION }),
  http: (url: string, init?: any) =>
    fetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), "Api-Key": API_KEY },
    }),
} as any;

async function main() {
  // 1) Validate the key + region with a harmless read query (no writes).
  console.log(`→ NerdGraph ${ENDPOINT} (region ${REGION})`);
  const res = await ctx.http(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{ actor { user { name email } accounts { id name } } }`,
    }),
  });
  const json: any = await res.json();
  if (json.errors?.length) {
    console.error("✗ Key rejected / GraphQL errors:", json.errors);
    process.exit(1);
  }
  const actor = json?.data?.actor;
  console.log(`✓ Authenticated as: ${actor?.user?.name} <${actor?.user?.email}>`);
  console.log(`✓ Accounts visible:`, actor?.accounts?.map((a: any) => `${a.id}:${a.name}`).join(", ") || "(none)");

  // 2) Optionally exercise a real plugin tool (a create mutation).
  if (process.argv.includes("--create")) {
    if (!ACCOUNT_ID) {
      console.error("--create needs NEW_RELIC_ACCOUNT_ID");
      process.exit(1);
    }
    const out = await createAlertPolicy.handler(ctx, {
      accountId: ACCOUNT_ID,
      name: `workbench-smoke-${Date.now()}`,
      incidentPreference: "PER_POLICY",
    });
    console.log("→ newrelic_create_alert_policy result:", JSON.stringify(out, null, 2));
    console.log("  (delete it in New Relic › Alerts › Policies if you don't want it.)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
