import { z } from "zod";

export const listRepos = {
  name: "bitbucket_list_repos",
  description: "List Bitbucket repositories for a workspace",
  integration: "atlassian-bitbucket",
  inputSchema: z.object({
    workspace: z.string(),
    page: z.number().default(1),
    pagelen: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("page", String(args.page));
    params.set("pagelen", String(args.pagelen));
    const res = await ctx.http(`https://api.bitbucket.org/2.0/repositories/${args.workspace}?${params}`);
    return res.json();
  },
};

export const createPR = {
  name: "bitbucket_create_pr",
  description: "Create a Bitbucket pull request",
  integration: "atlassian-bitbucket",
  inputSchema: z.object({
    workspace: z.string(),
    repoSlug: z.string(),
    title: z.string(),
    sourceBranch: z.string(),
    destinationBranch: z.string().default("main"),
    description: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(
      `https://api.bitbucket.org/2.0/repositories/${args.workspace}/${args.repoSlug}/pullrequests`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: args.title,
          source: { branch: { name: args.sourceBranch } },
          destination: { branch: { name: args.destinationBranch } },
          description: args.description,
        }),
      }
    );
    return res.json();
  },
};
