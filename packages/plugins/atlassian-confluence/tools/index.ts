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
