import { describe, it, expect, vi } from "vitest";
import {
  createAlertPolicy,
  createStaticNrqlAlertCondition,
  addTagsToEntity,
  addWidgetsToDashboardPage,
  createAiNotificationsDestination,
  createAiWorkflow,
  runNrql,
  searchEntities,
  getDashboard,
} from "../../plugins/newrelic/tools/index";

// Recording ctx: captures the NerdGraph endpoint + POST body, replies canned.
// region drives endpoint selection (US default, EU override).
function recordingCtx(dataReply: unknown = {}, region = "US") {
  const urls: string[] = [];
  const bodies: any[] = [];
  const http = vi.fn(async (url: string, init?: any) => {
    urls.push(url);
    bodies.push(init?.body ? JSON.parse(init.body) : undefined);
    return { status: 200, json: async () => ({ data: dataReply }) } as any;
  });
  return { ctx: { http, getConfig: () => ({ region }) } as any, urls, bodies };
}

describe("newrelic endpoint region routing", () => {
  it("posts to the US endpoint by default", async () => {
    const { ctx, urls } = recordingCtx({ alertsPolicyCreate: { id: "1" } });
    await createAlertPolicy.handler(ctx, { accountId: 1, name: "p" });
    expect(urls[0]).toBe("https://api.newrelic.com/graphql");
  });

  it("posts to the EU endpoint when region=EU", async () => {
    const { ctx, urls } = recordingCtx({ alertsPolicyCreate: { id: "1" } }, "EU");
    await createAlertPolicy.handler(ctx, { accountId: 1, name: "p" });
    expect(urls[0]).toBe("https://api.eu.newrelic.com/graphql");
  });
});

describe("newrelic_create_alert_policy", () => {
  it("sends accountId + policy with default incidentPreference", async () => {
    const { ctx, bodies } = recordingCtx({ alertsPolicyCreate: { id: "42", name: "p" } });
    const out = await createAlertPolicy.handler(ctx, { accountId: 7, name: "My Policy" });
    expect(bodies[0].variables).toEqual({
      accountId: 7,
      policy: { name: "My Policy", incidentPreference: "PER_POLICY" },
    });
    expect(out).toEqual({ alertsPolicyCreate: { id: "42", name: "p" } });
  });
});

describe("newrelic_create_static_nrql_condition", () => {
  it("builds the term + signal and omits expiration when unset", async () => {
    const { ctx, bodies } = recordingCtx({ alertsNrqlConditionStaticCreate: { id: "9" } });
    await createStaticNrqlAlertCondition.handler(ctx, {
      accountId: 1,
      policyId: "5",
      name: "c",
      nrql: "SELECT count(*) FROM Transaction",
      enabled: true,
      threshold: 10,
      operator: "ABOVE",
      priority: "CRITICAL",
      thresholdDuration: 300,
      thresholdOccurrences: "ALL",
      aggregationWindow: 60,
      aggregationMethod: "EVENT_FLOW",
      aggregationDelay: 120,
      fillOption: "NONE",
      openViolationOnExpiration: false,
      closeViolationsOnExpiration: false,
    });
    const cond = bodies[0].variables.condition;
    expect(cond.nrql).toEqual({ query: "SELECT count(*) FROM Transaction" });
    expect(cond.terms[0]).toMatchObject({ threshold: 10, operator: "ABOVE", priority: "CRITICAL" });
    expect(cond.signal.aggregationMethod).toBe("EVENT_FLOW");
    expect(cond).not.toHaveProperty("expiration");
  });

  it("adds expiration block for signal-loss detection", async () => {
    const { ctx, bodies } = recordingCtx({ alertsNrqlConditionStaticCreate: { id: "9" } });
    await createStaticNrqlAlertCondition.handler(ctx, {
      accountId: 1,
      policyId: "5",
      name: "c",
      nrql: "SELECT count(*) FROM Transaction",
      threshold: 1,
      expirationDuration: 600,
      openViolationOnExpiration: true,
      closeViolationsOnExpiration: false,
    });
    expect(bodies[0].variables.condition.expiration).toEqual({
      expirationDuration: 600,
      openViolationOnExpiration: true,
      closeViolationsOnExpiration: false,
    });
  });
});

describe("newrelic_add_widgets_to_dashboard_page", () => {
  it("shapes widget visualization/layout/rawConfiguration from flat input", async () => {
    const { ctx, bodies } = recordingCtx({ dashboardAddWidgetsToPage: { errors: [] } });
    await addWidgetsToDashboardPage.handler(ctx, {
      pageGuid: "PAGE_GUID",
      widgets: [
        {
          title: "Errors",
          visualizationId: "viz.line",
          column: 1,
          row: 1,
          width: 4,
          height: 3,
          nrqlQueries: [{ accountId: 1, query: "SELECT count(*) FROM TransactionError" }],
        },
      ],
    });
    const w = bodies[0].variables.widgets[0];
    expect(bodies[0].variables.guid).toBe("PAGE_GUID");
    expect(w.visualization).toEqual({ id: "viz.line" });
    expect(w.layout).toEqual({ column: 1, row: 1, width: 4, height: 3 });
    expect(w.rawConfiguration.nrqlQueries).toEqual([
      { accountId: 1, query: "SELECT count(*) FROM TransactionError" },
    ]);
  });
});

describe("newrelic_add_tags_to_entity", () => {
  it("forwards guid + tags", async () => {
    const { ctx, bodies } = recordingCtx({ taggingAddTagsToEntity: { errors: [] } });
    await addTagsToEntity.handler(ctx, {
      guid: "ENTITY_GUID",
      tags: [{ key: "team", values: ["payments"] }],
    });
    expect(bodies[0].variables).toEqual({
      guid: "ENTITY_GUID",
      tags: [{ key: "team", values: ["payments"] }],
    });
  });
});

describe("newrelic_create_ai_notifications_destination", () => {
  it("omits auth when not provided", async () => {
    const { ctx, bodies } = recordingCtx({ aiNotificationsCreateDestination: {} });
    await createAiNotificationsDestination.handler(ctx, {
      accountId: 1,
      name: "Jira",
      type: "JIRA",
      properties: [{ key: "url", value: "https://acme.atlassian.net" }],
    });
    expect(bodies[0].variables.destination).not.toHaveProperty("auth");
    expect(bodies[0].variables.destination.properties).toEqual([
      { key: "url", value: "https://acme.atlassian.net" },
    ]);
  });
});

describe("newrelic_create_ai_workflow", () => {
  it("maps channelIds to destinationConfigurations and wraps predicates in the filter", async () => {
    const { ctx, bodies } = recordingCtx({ aiWorkflowsCreateWorkflow: {} });
    await createAiWorkflow.handler(ctx, {
      accountId: 1,
      name: "wf",
      channelIds: ["chan-1", "chan-2"],
      notificationTrigger: "ACTIVATED",
      filterName: "f",
      predicates: [{ attribute: "labels.policyIds", operator: "EXACTLY_MATCHES", values: ["42"] }],
      workflowEnabled: true,
      mutingRulesHandling: "NOTIFY_ALL_ISSUES",
    });
    const data = bodies[0].variables.createWorkflowData;
    expect(data.destinationConfigurations).toEqual([
      { channelId: "chan-1", notificationTriggers: ["ACTIVATED"] },
      { channelId: "chan-2", notificationTriggers: ["ACTIVATED"] },
    ]);
    expect(data.issuesFilter).toEqual({
      name: "f",
      type: "FILTER",
      predicates: [{ attribute: "labels.policyIds", operator: "EXACTLY_MATCHES", values: ["42"] }],
    });
    expect(data.enrichmentsEnabled).toBe(false);
  });
});

describe("newrelic_run_nrql", () => {
  it("unwraps actor.account.nrql to the result payload", async () => {
    const { ctx, bodies } = recordingCtx({
      actor: { account: { nrql: { results: [{ count: 5 }], metadata: { eventTypes: ["Transaction"] } } } },
    });
    const out: any = await runNrql.handler(ctx, {
      accountId: 2880242,
      nrql: "SELECT count(*) FROM Transaction",
    });
    expect(bodies[0].variables).toEqual({ accountId: 2880242, nrql: "SELECT count(*) FROM Transaction" });
    expect(out.results).toEqual([{ count: 5 }]);
    expect(out.metadata.eventTypes).toEqual(["Transaction"]);
  });
});

describe("newrelic_search_entities", () => {
  it("builds an ANDed entitySearch query from name/type and slims results", async () => {
    const { ctx, bodies } = recordingCtx({
      actor: {
        entitySearch: {
          count: 1,
          results: { entities: [{ guid: "GUID1", name: "api", type: "DASHBOARD", entityType: "DASHBOARD_ENTITY", domain: "VIZ" }] },
        },
      },
    });
    const out: any = await searchEntities.handler(ctx, { name: "api", type: "DASHBOARD", limit: 25 });
    expect(bodies[0].variables.searchQuery).toBe("name LIKE '%api%' AND type = 'DASHBOARD'");
    expect(out).toEqual({
      count: 1,
      entities: [{ guid: "GUID1", name: "api", type: "DASHBOARD", entityType: "DASHBOARD_ENTITY", domain: "VIZ" }],
    });
  });

  it("prefers a raw query over the helper fields", async () => {
    const { ctx, bodies } = recordingCtx({ actor: { entitySearch: { count: 0, results: { entities: [] } } } });
    await searchEntities.handler(ctx, { name: "ignored", query: "domain = 'VIZ'", limit: 25 });
    expect(bodies[0].variables.searchQuery).toBe("domain = 'VIZ'");
  });

  it("errors when no filter is supplied", async () => {
    const { ctx } = recordingCtx({});
    const out: any = await searchEntities.handler(ctx, { limit: 25 });
    expect(out).toEqual({ error: "Provide name, domain, type, or a raw query." });
  });
});

describe("newrelic_get_dashboard", () => {
  it("forwards the guid and unwraps actor.entity", async () => {
    const { ctx, bodies } = recordingCtx({
      actor: { entity: { guid: "GUID1", name: "My Dashboard", pages: [] } },
    });
    const out: any = await getDashboard.handler(ctx, { guid: "GUID1" });
    expect(bodies[0].variables).toEqual({ guid: "GUID1" });
    expect(out).toEqual({ guid: "GUID1", name: "My Dashboard", pages: [] });
  });
});

describe("accountId resolution", () => {
  it("falls back to the connection's default accountId when omitted", async () => {
    const bodies: any[] = [];
    const ctx = {
      http: async (_url: string, init: any) => {
        bodies.push(JSON.parse(init.body));
        return { status: 200, json: async () => ({ data: { alertsPolicyCreate: { id: "1" } } }) };
      },
      getConfig: () => ({ region: "US", accountId: "999111" }),
    } as any;
    await createAlertPolicy.handler(ctx, { name: "p" });
    expect(bodies[0].variables.accountId).toBe(999111);
  });

  it("prefers an explicit accountId over the default", async () => {
    const bodies: any[] = [];
    const ctx = {
      http: async (_url: string, init: any) => {
        bodies.push(JSON.parse(init.body));
        return { status: 200, json: async () => ({ data: {} }) };
      },
      getConfig: () => ({ region: "US", accountId: "999111" }),
    } as any;
    await createAlertPolicy.handler(ctx, { accountId: 42, name: "p" });
    expect(bodies[0].variables.accountId).toBe(42);
  });

  it("throws when neither an arg nor a default is set", async () => {
    const ctx = { http: async () => ({}), getConfig: () => ({ region: "US" }) } as any;
    await expect(createAlertPolicy.handler(ctx, { name: "p" })).rejects.toThrow(/No account id/);
  });
});

describe("nerdgraph error surfacing", () => {
  it("returns errors[] when NerdGraph replies with GraphQL errors", async () => {
    const http = vi.fn(async () => ({
      status: 200,
      json: async () => ({ errors: [{ message: "boom" }] }),
    })) as any;
    const ctx = { http, getConfig: () => ({ region: "US" }) } as any;
    const out: any = await createAlertPolicy.handler(ctx, { accountId: 1, name: "p" });
    expect(out).toEqual({ errors: ["boom"] });
  });
});
