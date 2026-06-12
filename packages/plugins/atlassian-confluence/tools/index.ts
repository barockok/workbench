import { z } from "zod";

// Escape user input for interpolation inside a double-quoted CQL literal.
function escapeCql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// The v1 content endpoints return Atlassian's full envelope (_expandable,
// _links, breadcrumbs, …). Trim each content row to what an agent acts on.
function slimContent(c: any) {
  return {
    id: c.id,
    type: c.type,
    status: c.status,
    title: c.title,
    spaceKey: c.space?.key,
    version: c.version?.number,
    url: c._links?.webui,
  };
}

export const createPage = {
  name: "confluence_create_page",
  description:
    "Create a Confluence page in a space. body is Confluence storage format (XHTML) — plain text works for simple pages. Pass parentId to nest under an existing page. Returns the new page's id, title, and url.",
  integration: "atlassian-confluence",
  inputSchema: z.object({
    spaceKey: z.string(),
    title: z.string(),
    body: z.string(),
    parentId: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const body: any = {
      type: "page",
      title: args.title,
      space: { key: args.spaceKey },
      body: {
        storage: {
          value: args.body,
          representation: "storage",
        },
      },
    };
    if (args.parentId) {
      body.ancestors = [{ id: args.parentId }];
    }
    const res = await ctx.http("https://api.atlassian.com/ex/confluence/cloud-id/wiki/rest/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data?.id) return slimContent(data);
    return data;
  },
};

export const searchPages = {
  name: "confluence_search_pages",
  description:
    "Full-text search Confluence pages. Returns up to `limit` (default 10) slim rows: id, title, spaceKey, url. Use confluence_get_page with an id to read content.",
  integration: "atlassian-confluence",
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("cql", `text ~ "${escapeCql(args.query)}"`);
    params.set("limit", String(args.limit));
    params.set("expand", "space,version");
    const res = await ctx.http(`https://api.atlassian.com/ex/confluence/cloud-id/wiki/rest/api/content/search?${params}`);
    const data = await res.json();
    if (!Array.isArray(data?.results)) return data;
    return {
      results: data.results.map(slimContent),
      size: data.size,
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
    pageId: z.string().regex(/^\d+$/, "pageId must be numeric"),
    expand: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    // v1 GET /content/{id} was removed (410) and v2 needs granular scopes the
    // app can't use yet — fetch via the still-alive CQL search endpoint, same
    // workaround as listSpaces. See
    // docs/findings/2026-06-12-confluence-v1-content-get-removed.md
    const params = new URLSearchParams();
    params.set("cql", `id=${args.pageId}`);
    params.set("limit", "1");
    params.set("expand", args.expand ?? "body.storage,version,space");
    const res = await ctx.http(`https://api.atlassian.com/ex/confluence/cloud-id/wiki/rest/api/content/search?${params}`);
    const data = await res.json();
    const page = data?.results?.[0];
    if (!page) return { error: `Page ${args.pageId} not found` };
    return {
      ...slimContent(page),
      body: page.body?.storage?.value,
    };
  },
};

export const listSpaces = {
  name: "confluence_list_spaces",
  description:
    "List Confluence spaces (up to `limit`, default 25). Returns slim rows: key, name, url. Space keys are needed by confluence_create_page.",
  integration: "atlassian-confluence",
  inputSchema: z.object({
    limit: z.number().default(25),
  }),
  handler: async (ctx: any, args: any) => {
    // Legacy /wiki/rest/api/space was removed (410), and the v2
    // /wiki/api/v2/spaces endpoint requires granular Confluence scopes
    // that aren't selectable while the app uses classic scopes. Fall
    // back to a CQL search for type=space, which only needs
    // `search:confluence` (already granted) and returns the spaces in
    // the same kind of `results` envelope.
    const params = new URLSearchParams();
    params.set("cql", "type=space");
    params.set("limit", String(args.limit));
    const res = await ctx.http(`https://api.atlassian.com/ex/confluence/cloud-id/wiki/rest/api/search?${params}`);
    const data = await res.json();
    if (!Array.isArray(data?.results)) return data;
    return {
      results: data.results.map((r: any) => ({
        key: r.space?.key,
        name: r.space?.name ?? r.title,
        url: r.url,
      })),
      size: data.size,
      hasMore: Boolean(data._links?.next),
    };
  },
};

export const updatePage = {
  name: "confluence_update_page",
  description:
    "Update a Confluence page's title and body. `version` must be the page's CURRENT version number (from confluence_get_page) — the API stores version+1 and rejects stale numbers.",
  integration: "atlassian-confluence",
  inputSchema: z.object({
    pageId: z.string(),
    title: z.string(),
    body: z.string(),
    version: z.number(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(`https://api.atlassian.com/ex/confluence/cloud-id/wiki/rest/api/content/${args.pageId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "page",
        title: args.title,
        body: {
          storage: {
            value: args.body,
            representation: "storage",
          },
        },
        version: { number: args.version + 1 },
      }),
    });
    const data = await res.json();
    if (data?.id) return slimContent(data);
    return data;
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
    const res = await ctx.http(`https://api.atlassian.com/ex/confluence/cloud-id/wiki/rest/api/content/${args.pageId}`, {
      method: "DELETE",
    });
    if (res.status === 204) return { success: true };
    return res.json();
  },
};
