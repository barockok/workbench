"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchPages = exports.createPage = void 0;
const zod_1 = require("zod");
exports.createPage = {
    name: "confluence_create_page",
    description: "Create a Confluence page",
    integration: "atlassian-confluence",
    inputSchema: zod_1.z.object({
        spaceKey: zod_1.z.string(),
        title: zod_1.z.string(),
        body: zod_1.z.string(),
        parentId: zod_1.z.string().optional(),
    }),
    handler: async (ctx, args) => {
        const body = {
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
exports.searchPages = {
    name: "confluence_search_pages",
    description: "Search Confluence pages",
    integration: "atlassian-confluence",
    inputSchema: zod_1.z.object({
        query: zod_1.z.string(),
        limit: zod_1.z.number().default(10),
    }),
    handler: async (ctx, args) => {
        const params = new URLSearchParams();
        params.set("cql", `text ~ "${args.query}"`);
        params.set("limit", String(args.limit));
        const res = await ctx.http(`https://api.atlassian.com/ex/confluence/cloud-id/wiki/rest/api/content/search?${params}`);
        return res.json();
    },
};
