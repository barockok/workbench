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
