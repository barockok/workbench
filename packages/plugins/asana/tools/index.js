"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listTasks = exports.createTask = void 0;
const zod_1 = require("zod");
exports.createTask = {
    name: "asana_create_task",
    description: "Create an Asana task",
    integration: "asana",
    inputSchema: zod_1.z.object({
        projectId: zod_1.z.string(),
        name: zod_1.z.string(),
        notes: zod_1.z.string().optional(),
        assignee: zod_1.z.string().optional(),
        dueOn: zod_1.z.string().optional(),
    }),
    handler: async (ctx, args) => {
        const body = {
            data: {
                projects: [args.projectId],
                name: args.name,
                notes: args.notes,
            },
        };
        if (args.assignee)
            body.data.assignee = args.assignee;
        if (args.dueOn)
            body.data.due_on = args.dueOn;
        const res = await ctx.http("https://app.asana.com/api/1.0/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return res.json();
    },
};
exports.listTasks = {
    name: "asana_list_tasks",
    description: "List tasks in an Asana project",
    integration: "asana",
    inputSchema: zod_1.z.object({
        projectId: zod_1.z.string(),
        limit: zod_1.z.number().default(10),
    }),
    handler: async (ctx, args) => {
        const params = new URLSearchParams();
        params.set("project", args.projectId);
        params.set("limit", String(args.limit));
        const res = await ctx.http(`https://app.asana.com/api/1.0/tasks?${params}`);
        return res.json();
    },
};
