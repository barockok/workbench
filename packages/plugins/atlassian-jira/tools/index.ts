import { z } from "zod";

export const createIssue = {
  name: "jira_create_issue",
  description: "Create a Jira issue",
  integration: "atlassian-jira",
  inputSchema: z.object({
    projectKey: z.string(),
    summary: z.string(),
    description: z.string().optional(),
    issueType: z.string().default("Task"),
  }),
  handler: async (ctx: any, args: any) => {
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

export const searchIssues = {
  name: "jira_search_issues",
  description: "Search Jira issues with JQL",
  integration: "atlassian-jira",
  inputSchema: z.object({
    jql: z.string(),
    maxResults: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("jql", args.jql);
    params.set("maxResults", String(args.maxResults));
    const res = await ctx.http(`https://api.atlassian.com/ex/jira/cloud-id/rest/api/3/search?${params}`);
    return res.json();
  },
};

export const getIssue = {
  name: "jira_get_issue",
  description: "Get a Jira issue by key",
  integration: "atlassian-jira",
  inputSchema: z.object({
    issueKey: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(`https://api.atlassian.com/ex/jira/cloud-id/rest/api/3/issue/${args.issueKey}`);
    return res.json();
  },
};

export const searchUsers = {
  name: "jira_search_users",
  description: "Search Jira users by query",
  integration: "atlassian-jira",
  inputSchema: z.object({
    query: z.string(),
    maxResults: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("query", args.query);
    params.set("maxResults", String(args.maxResults));
    const res = await ctx.http(`https://api.atlassian.com/ex/jira/cloud-id/rest/api/3/user/search?${params}`);
    return res.json();
  },
};

export const getBoards = {
  name: "jira_get_boards",
  description: "List Jira boards (Agile API)",
  integration: "atlassian-jira",
  inputSchema: z.object({
    projectKey: z.string().optional(),
    maxResults: z.number().default(50),
    startAt: z.number().default(0),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    if (args.projectKey) params.set("projectKeyOrId", args.projectKey);
    params.set("maxResults", String(args.maxResults));
    params.set("startAt", String(args.startAt));
    const res = await ctx.http(`https://api.atlassian.com/ex/jira/cloud-id/rest/agile/1.0/board?${params}`);
    return res.json();
  },
};

export const getProjectTypes = {
  name: "jira_project_types",
  description: "List available Jira project types",
  integration: "atlassian-jira",
  inputSchema: z.object({}),
  handler: async (ctx: any, _args: any) => {
    const res = await ctx.http("https://api.atlassian.com/ex/jira/cloud-id/rest/api/3/project/type");
    return res.json();
  },
};
