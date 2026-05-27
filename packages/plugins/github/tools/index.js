"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPR = exports.createIssue = exports.listRepos = void 0;
const zod_1 = require("zod");
exports.listRepos = {
    name: "github_list_repos",
    description: "List GitHub repositories for the authenticated user",
    integration: "github",
    inputSchema: zod_1.z.object({
        type: zod_1.z.enum(["all", "owner", "member"]).default("all"),
        perPage: zod_1.z.number().default(30),
        page: zod_1.z.number().default(1),
    }),
    handler: async (ctx, args) => {
        const params = new URLSearchParams();
        params.set("type", args.type);
        params.set("per_page", String(args.perPage));
        params.set("page", String(args.page));
        const res = await ctx.http(`https://api.github.com/user/repos?${params}`);
        return res.json();
    },
};
exports.createIssue = {
    name: "github_create_issue",
    description: "Create a GitHub issue",
    integration: "github",
    inputSchema: zod_1.z.object({
        owner: zod_1.z.string(),
        repo: zod_1.z.string(),
        title: zod_1.z.string(),
        body: zod_1.z.string().optional(),
        labels: zod_1.z.array(zod_1.z.string()).optional(),
    }),
    handler: async (ctx, args) => {
        const body = { title: args.title };
        if (args.body)
            body.body = args.body;
        if (args.labels)
            body.labels = args.labels;
        const res = await ctx.http(`https://api.github.com/repos/${args.owner}/${args.repo}/issues`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return res.json();
    },
};
exports.createPR = {
    name: "github_create_pr",
    description: "Create a GitHub pull request",
    integration: "github",
    inputSchema: zod_1.z.object({
        owner: zod_1.z.string(),
        repo: zod_1.z.string(),
        title: zod_1.z.string(),
        head: zod_1.z.string(),
        base: zod_1.z.string(),
        body: zod_1.z.string().optional(),
    }),
    handler: async (ctx, args) => {
        const body = {
            title: args.title,
            head: args.head,
            base: args.base,
        };
        if (args.body)
            body.body = args.body;
        const res = await ctx.http(`https://api.github.com/repos/${args.owner}/${args.repo}/pulls`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return res.json();
    },
};
