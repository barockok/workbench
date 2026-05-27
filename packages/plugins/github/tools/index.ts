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

export const getRepo = {
  name: "github_get_repo",
  description: "Get a GitHub repository by owner and name",
  integration: "github",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(`https://api.github.com/repos/${args.owner}/${args.repo}`);
    return res.json();
  },
};

export const getContent = {
  name: "github_get_content",
  description: "Get contents of a file or directory in a GitHub repo",
  integration: "github",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    path: z.string().default(""),
    ref: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("path", args.path);
    if (args.ref) params.set("ref", args.ref);
    const res = await ctx.http(`https://api.github.com/repos/${args.owner}/${args.repo}/contents/${args.path}?${params}`);
    return res.json();
  },
};

export const listCommits = {
  name: "github_list_commits",
  description: "List commits in a GitHub repository",
  integration: "github",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    sha: z.string().optional(),
    perPage: z.number().default(30),
    page: z.number().default(1),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    if (args.sha) params.set("sha", args.sha);
    params.set("per_page", String(args.perPage));
    params.set("page", String(args.page));
    const res = await ctx.http(`https://api.github.com/repos/${args.owner}/${args.repo}/commits?${params}`);
    return res.json();
  },
};

export const listBranches = {
  name: "github_list_branches",
  description: "List branches in a GitHub repository",
  integration: "github",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    perPage: z.number().default(30),
    page: z.number().default(1),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("per_page", String(args.perPage));
    params.set("page", String(args.page));
    const res = await ctx.http(`https://api.github.com/repos/${args.owner}/${args.repo}/branches?${params}`);
    return res.json();
  },
};

export const createOrUpdateFile = {
  name: "github_create_or_update_file",
  description: "Create or update a file in a GitHub repository",
  integration: "github",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    path: z.string(),
    message: z.string(),
    content: z.string(),
    sha: z.string().optional(),
    branch: z.string().default("main"),
  }),
  handler: async (ctx: any, args: any) => {
    const body: any = {
      message: args.message,
      content: Buffer.from(args.content).toString("base64"),
      branch: args.branch,
    };
    if (args.sha) body.sha = args.sha;
    const res = await ctx.http(`https://api.github.com/repos/${args.owner}/${args.repo}/contents/${args.path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
};

export const listReleases = {
  name: "github_list_releases",
  description: "List releases for a GitHub repository",
  integration: "github",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    perPage: z.number().default(30),
    page: z.number().default(1),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("per_page", String(args.perPage));
    params.set("page", String(args.page));
    const res = await ctx.http(`https://api.github.com/repos/${args.owner}/${args.repo}/releases?${params}`);
    return res.json();
  },
};
