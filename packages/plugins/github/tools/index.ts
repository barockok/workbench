import { z } from "zod";

export const listRepos = {
  name: "github_list_repos",
  description: "List GitHub repositories for the authenticated user",
  integration: "github",
  inputSchema: z.object({
    type: z.enum(["all", "owner", "member"]).default("all"),
    perPage: z.number().default(30),
    page: z.number().default(1),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("type", args.type);
    params.set("per_page", String(args.perPage));
    params.set("page", String(args.page));
    const res = await ctx.http(`https://api.github.com/user/repos?${params}`);
    return res.json();
  },
};

export const createIssue = {
  name: "github_create_issue",
  description: "Create a GitHub issue",
  integration: "github",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const body: any = { title: args.title };
    if (args.body) body.body = args.body;
    if (args.labels) body.labels = args.labels;
    const res = await ctx.http(`https://api.github.com/repos/${args.owner}/${args.repo}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
};

export const createPR = {
  name: "github_create_pr",
  description: "Create a GitHub pull request",
  integration: "github",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
    head: z.string(),
    base: z.string(),
    body: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const body: any = {
      title: args.title,
      head: args.head,
      base: args.base,
    };
    if (args.body) body.body = args.body;
    const res = await ctx.http(`https://api.github.com/repos/${args.owner}/${args.repo}/pulls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
};
