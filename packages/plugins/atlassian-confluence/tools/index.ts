import { z } from "zod";

export const createPage = {
  name: "confluence_create_page",
  description: "Create a Confluence page",
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
    return res.json();
  },
};

export const searchPages = {
  name: "confluence_search_pages",
  description: "Search Confluence pages",
  integration: "atlassian-confluence",
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("cql", `text ~ "${args.query}"`);
    params.set("limit", String(args.limit));
    const res = await ctx.http(`https://api.atlassian.com/ex/confluence/cloud-id/wiki/rest/api/content/search?${params}`);
    return res.json();
  },
};

export const getPage = {
  name: "confluence_get_page",
  description: "Get a Confluence page by ID",
  integration: "atlassian-confluence",
  inputSchema: z.object({
    pageId: z.string(),
    expand: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    if (args.expand) params.set("expand", args.expand);
    const res = await ctx.http(`https://api.atlassian.com/ex/confluence/cloud-id/wiki/rest/api/content/${args.pageId}?${params}`);
    return res.json();
  },
};

export const listSpaces = {
  name: "confluence_list_spaces",
  description: "List Confluence spaces",
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
    return res.json();
  },
};

export const updatePage = {
  name: "confluence_update_page",
  description: "Update a Confluence page",
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
        version: { number: args.version },
      }),
    });
    return res.json();
  },
};

export const deletePage = {
  name: "confluence_delete_page",
  description: "Delete a Confluence page",
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
