import { z } from "zod";

export const createTask = {
  name: "asana_create_task",
  description: "Create an Asana task",
  integration: "asana",
  inputSchema: z.object({
    projectId: z.string(),
    name: z.string(),
    notes: z.string().optional(),
    assignee: z.string().optional(),
    dueOn: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const body: any = {
      data: {
        projects: [args.projectId],
        name: args.name,
        notes: args.notes,
      },
    };
    if (args.assignee) body.data.assignee = args.assignee;
    if (args.dueOn) body.data.due_on = args.dueOn;

    const res = await ctx.http("https://app.asana.com/api/1.0/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
};

export const listTasks = {
  name: "asana_list_tasks",
  description: "List tasks in an Asana project",
  integration: "asana",
  inputSchema: z.object({
    projectId: z.string(),
    limit: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("project", args.projectId);
    params.set("limit", String(args.limit));
    const res = await ctx.http(`https://app.asana.com/api/1.0/tasks?${params}`);
    return res.json();
  },
};

export const listProjects = {
  name: "asana_list_projects",
  description: "List Asana projects in a workspace",
  integration: "asana",
  inputSchema: z.object({
    workspaceId: z.string().optional(),
    limit: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    if (args.workspaceId) params.set("workspace", args.workspaceId);
    params.set("limit", String(args.limit));
    const res = await ctx.http(`https://app.asana.com/api/1.0/projects?${params}`);
    return res.json();
  },
};

export const listTeams = {
  name: "asana_list_teams",
  description: "List teams in an Asana organization",
  integration: "asana",
  inputSchema: z.object({
    organizationId: z.string(),
    limit: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("organization", args.organizationId);
    params.set("limit", String(args.limit));
    const res = await ctx.http(`https://app.asana.com/api/1.0/teams?${params}`);
    return res.json();
  },
};

export const searchUsers = {
  name: "asana_search_users",
  description: "Search Asana users in a workspace",
  integration: "asana",
  inputSchema: z.object({
    workspaceId: z.string(),
    query: z.string().optional(),
    limit: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("workspace", args.workspaceId);
    if (args.query) params.set("search", args.query);
    params.set("limit", String(args.limit));
    const res = await ctx.http(`https://app.asana.com/api/1.0/users?${params}`);
    return res.json();
  },
};
