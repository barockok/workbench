import { z } from "zod";

// Atlassian Confluence Cloud REST v2.
//
// The whole v1 content family (`/wiki/rest/api/content...`) is being removed by
// Atlassian (RFC-19); calls already 410 with
//   GoneException: "This deprecated endpoint has been removed."
// so every page/space op below runs on v2 (`/wiki/api/v2/...`). Full-text search
// has no v2 equivalent, so search_pages stays on the still-supported generic CQL
// search endpoint (`/wiki/rest/api/search`, `search:confluence` scope).
//
// `cloud-id` is a literal placeholder — ctx.http() resolves it to the user's
// Atlassian site id for ANY path under /ex/confluence/cloud-id/ (see
// packages/server/src/plugins/context.ts), so v2 paths work unchanged.
const V2 = "https://api.atlassian.com/ex/confluence/cloud-id/wiki/api/v2";
const SEARCH = "https://api.atlassian.com/ex/confluence/cloud-id/wiki/rest/api/search";

// Escape user input for interpolation inside a double-quoted CQL literal.
function escapeCql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Surface the real upstream status + body on failure instead of returning a 4xx
// envelope as if it were a success. Throwing is caught by the executor and
// reported to the MCP client as { error } (see mcp/meta-tools.ts).
async function readJson(res: any, label: string): Promise<any> {
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      try {
        detail = await res.text();
      } catch {
        /* body already consumed / empty */
      }
    }
    throw new Error(`${label}: HTTP ${res.status} ${detail.slice(0, 400)}`);
  }
  return res.json();
}

// --- spaceKey <-> spaceId resolution -------------------------------------
//
// v2 page ops key off the numeric `spaceId`, but the external create_page tool
// (and the slim output shape consumers parse) speak `spaceKey`. Resolve+cache
// both directions. spaceId is per-site and the cloud-id is resolved per-user, so
// key the cache by ctx.userId to stay correct when two users sit on different
// Atlassian sites that happen to share a spaceKey.
const spaceCache = new Map<string, { id: string; key: string }>();

function cacheSpace(userId: string, sp: { id: string | number; key: string }): { id: string; key: string } {
  const entry = { id: String(sp.id), key: sp.key };
  spaceCache.set(`${userId}:key:${entry.key}`, entry);
  spaceCache.set(`${userId}:id:${entry.id}`, entry);
  return entry;
}

async function resolveSpaceIdByKey(ctx: any, spaceKey: string): Promise<{ id: string; key: string }> {
  const hit = spaceCache.get(`${ctx.userId}:key:${spaceKey}`);
  if (hit) return hit;
  const params = new URLSearchParams();
  params.set("keys", spaceKey);
  params.set("limit", "1");
  const res = await ctx.http(`${V2}/spaces?${params}`);
  const data = await readJson(res, `confluence resolve space "${spaceKey}"`);
  const sp = data?.results?.[0];
  if (!sp?.id) throw new Error(`Confluence space not found: ${spaceKey}`);
  return cacheSpace(ctx.userId, sp);
}

// Best-effort reverse lookup so page outputs can keep their `spaceKey` field.
// Never throws — a page is still usable without its space key.
async function resolveSpaceKeyById(ctx: any, spaceId: string | undefined): Promise<string | undefined> {
  if (!spaceId) return undefined;
  const hit = spaceCache.get(`${ctx.userId}:id:${spaceId}`);
  if (hit) return hit.key;
  try {
    const res = await ctx.http(`${V2}/spaces/${spaceId}`);
    if (!res.ok) return undefined;
    const sp = await res.json();
    if (sp?.key) return cacheSpace(ctx.userId, sp).key;
  } catch {
    /* best effort */
  }
  return undefined;
}

// Trim a v2 page object to what an agent acts on, preserving the field names
// v1 consumers already parse (id, title, spaceKey, version, body, url).
async function slimPage(ctx: any, p: any, spaceKey?: string): Promise<any> {
  return {
    id: p.id,
    type: "page",
    status: p.status,
    title: p.title,
    spaceId: p.spaceId,
    spaceKey: spaceKey ?? (await resolveSpaceKeyById(ctx, p.spaceId)),
    version: p.version?.number,
    body: p.body?.storage?.value ?? p.body?.atlas_doc_format?.value,
    url: p._links?.webui,
  };
}

export const createPage = {
  name: "confluence_create_page",
  description:
    "Create a Confluence page in a space. body is Confluence storage format (XHTML) — plain text works for simple pages. Pass parentId to nest under an existing page. spaceKey is resolved to the numeric spaceId internally; pass spaceId directly to skip the lookup. Returns the new page's id, title, spaceKey, version, and url.",
  integration: "atlassian-confluence",
  inputSchema: z.object({
    spaceKey: z.string(),
    title: z.string(),
    body: z.string(),
    parentId: z.string().optional(),
    // Optional v2 fast-path: callers that already know the numeric space id can
    // pass it to skip the spaceKey→spaceId resolution call.
    spaceId: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const space = args.spaceId
      ? { id: args.spaceId, key: args.spaceKey }
      : await resolveSpaceIdByKey(ctx, args.spaceKey);
    const body: any = {
      spaceId: space.id,
      status: "current",
      title: args.title,
      body: { representation: "storage", value: args.body },
    };
    if (args.parentId) body.parentId = args.parentId;
    const res = await ctx.http(`${V2}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await readJson(res, "confluence_create_page");
    return slimPage(ctx, data, space.key);
  },
};

export const searchPages = {
  name: "confluence_search_pages",
  description:
    "Full-text search Confluence pages. Returns up to `limit` (default 10) slim rows: id, title, spaceKey, version, url. Use confluence_get_page with an id to read content.",
  integration: "atlassian-confluence",
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    // v2 has no full-text search; use the supported generic CQL search endpoint
    // (search:confluence scope). Page hits nest their content under `content`.
    const params = new URLSearchParams();
    params.set("cql", `type=page AND text ~ "${escapeCql(args.query)}"`);
    params.set("limit", String(args.limit));
    params.set("expand", "content.space,content.version");
    const res = await ctx.http(`${SEARCH}?${params}`);
    const data = await readJson(res, "confluence_search_pages");
    if (!Array.isArray(data?.results)) return data;
    return {
      results: data.results.map((r: any) => {
        const c = r.content ?? {};
        return {
          id: c.id,
          type: c.type ?? "page",
          status: c.status,
          title: c.title ?? r.title,
          spaceKey: c.space?.key ?? r.space?.key,
          version: c.version?.number,
          url: r.url ?? c._links?.webui,
        };
      }),
      size: data.size,
      // v2-style cursor pagination: the generic search envelope still exposes
      // `_links.next`, so report whether another page exists.
      hasMore: Boolean(data._links?.next),
    };
  },
};

export const getPage = {
  name: "confluence_get_page",
  description:
    "Get a Confluence page by ID, including its body (storage XHTML), version number, and space. Returns { id, title, spaceKey, version, body, url }. The version number is required by confluence_update_page.",
  integration: "atlassian-confluence",
  inputSchema: z.object({
    // v2 ids are 64-bit — long numeric strings; don't assume 9 digits.
    pageId: z.string().regex(/^\d+$/, "pageId must be numeric"),
    // Accepted for backward compatibility; v2 returns the body via body-format,
    // so legacy v1 `expand` values are ignored.
    expand: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(`${V2}/pages/${args.pageId}?body-format=storage`);
    if (res.status === 404) return { error: `Page ${args.pageId} not found` };
    const data = await readJson(res, "confluence_get_page");
    return slimPage(ctx, data);
  },
};

export const listSpaces = {
  name: "confluence_list_spaces",
  description:
    "List Confluence spaces (up to `limit`, default 25). Returns slim rows: key, name, id, url. Space keys are needed by confluence_create_page.",
  integration: "atlassian-confluence",
  inputSchema: z.object({
    limit: z.number().default(25),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("limit", String(args.limit));
    const res = await ctx.http(`${V2}/spaces?${params}`);
    const data = await readJson(res, "confluence_list_spaces");
    if (!Array.isArray(data?.results)) return data;
    // Warm the resolver cache while we have the full list in hand.
    for (const sp of data.results) {
      if (sp?.id && sp?.key) cacheSpace(ctx.userId, sp);
    }
    return {
      results: data.results.map((sp: any) => ({
        id: sp.id,
        key: sp.key,
        name: sp.name,
        url: sp._links?.webui,
      })),
      // v2 spaces is cursor-paginated via _links.next, not start/limit offsets.
      hasMore: Boolean(data._links?.next),
    };
  },
};

export const updatePage = {
  name: "confluence_update_page",
  description:
    "Update a Confluence page's title and body. `version` must be the page's CURRENT version number (from confluence_get_page) — the API stores version+1 and rejects stale numbers. Optional `message` annotates the version history.",
  integration: "atlassian-confluence",
  inputSchema: z.object({
    pageId: z.string(),
    title: z.string(),
    body: z.string(),
    version: z.number(),
    message: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const versionObj: any = { number: args.version + 1 };
    if (args.message) versionObj.message = args.message;
    const res = await ctx.http(`${V2}/pages/${args.pageId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: args.pageId,
        status: "current",
        title: args.title,
        body: { representation: "storage", value: args.body },
        version: versionObj,
      }),
    });
    const data = await readJson(res, "confluence_update_page");
    return slimPage(ctx, data);
  },
};

export const deletePage = {
  name: "confluence_delete_page",
  description: "Delete a Confluence page by ID (moves it to space trash). Irreversible via this API.",
  integration: "atlassian-confluence",
  inputSchema: z.object({
    pageId: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(`${V2}/pages/${args.pageId}`, { method: "DELETE" });
    if (res.status === 204) return { success: true };
    // Non-204 → surface the real status/body.
    const data = await readJson(res, "confluence_delete_page");
    return data;
  },
};
