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
