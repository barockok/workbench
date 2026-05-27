"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIssue = exports.searchIssues = exports.createIssue = void 0;
const zod_1 = require("zod");
exports.createIssue = {
    name: "jira_create_issue",
    description: "Create a Jira issue",
    integration: "atlassian-jira",
    inputSchema: zod_1.z.object({
        projectKey: zod_1.z.string(),
        summary: zod_1.z.string(),
        description: zod_1.z.string().optional(),
        issueType: zod_1.z.string().default("Task"),
    }),
    handler: async (ctx, args) => {
        const res = await ctx.http("https://api.atlassian.com/ex/jira/cloud-id/rest/api/3/issue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                fields: {
                    project: { key: args.projectKey },
                    summary: args.summary,
                    description: args.description
                        ? {
                            type: "doc",
                            version: 1,
                            content: [
                                {
                                    type: "paragraph",
                                    content: [{ type: "text", text: args.description }],
                                },
                            ],
                        }
                        : undefined,
                    issuetype: { name: args.issueType },
                },
            }),
        });
        return res.json();
    },
};
exports.searchIssues = {
    name: "jira_search_issues",
    description: "Search Jira issues with JQL",
    integration: "atlassian-jira",
    inputSchema: zod_1.z.object({
        jql: zod_1.z.string(),
        maxResults: zod_1.z.number().default(10),
    }),
    handler: async (ctx, args) => {
        const params = new URLSearchParams();
        params.set("jql", args.jql);
        params.set("maxResults", String(args.maxResults));
        const res = await ctx.http(`https://api.atlassian.com/ex/jira/cloud-id/rest/api/3/search?${params}`);
        return res.json();
    },
};
exports.getIssue = {
    name: "jira_get_issue",
    description: "Get a Jira issue by key",
    integration: "atlassian-jira",
    inputSchema: zod_1.z.object({
        issueKey: zod_1.z.string(),
    }),
    handler: async (ctx, args) => {
        const res = await ctx.http(`https://api.atlassian.com/ex/jira/cloud-id/rest/api/3/issue/${args.issueKey}`);
        return res.json();
    },
};
