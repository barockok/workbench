"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPR = exports.listRepos = void 0;
const zod_1 = require("zod");
exports.listRepos = {
    name: "bitbucket_list_repos",
    description: "List Bitbucket repositories for a workspace",
    integration: "atlassian-bitbucket",
    inputSchema: zod_1.z.object({
        workspace: zod_1.z.string(),
        page: zod_1.z.number().default(1),
        pagelen: zod_1.z.number().default(10),
    }),
    handler: async (ctx, args) => {
        const params = new URLSearchParams();
        params.set("page", String(args.page));
        params.set("pagelen", String(args.pagelen));
        const res = await ctx.http(`https://api.bitbucket.org/2.0/repositories/${args.workspace}?${params}`);
        return res.json();
    },
};
exports.createPR = {
    name: "bitbucket_create_pr",
    description: "Create a Bitbucket pull request",
    integration: "atlassian-bitbucket",
    inputSchema: zod_1.z.object({
        workspace: zod_1.z.string(),
        repoSlug: zod_1.z.string(),
        title: zod_1.z.string(),
        sourceBranch: zod_1.z.string(),
        destinationBranch: zod_1.z.string().default("main"),
        description: zod_1.z.string().optional(),
    }),
    handler: async (ctx, args) => {
        const res = await ctx.http(`https://api.bitbucket.org/2.0/repositories/${args.workspace}/${args.repoSlug}/pullrequests`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: args.title,
                source: { branch: { name: args.sourceBranch } },
                destination: { branch: { name: args.destinationBranch } },
                description: args.description,
            }),
        });
        return res.json();
    },
};
