import { z } from "zod";
export declare const createTask: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        projectId: z.ZodString;
        name: z.ZodString;
        notes: z.ZodOptional<z.ZodString>;
        assignee: z.ZodOptional<z.ZodString>;
        dueOn: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        projectId: string;
        notes?: string | undefined;
        assignee?: string | undefined;
        dueOn?: string | undefined;
    }, {
        name: string;
        projectId: string;
        notes?: string | undefined;
        assignee?: string | undefined;
        dueOn?: string | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
export declare const listTasks: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        projectId: z.ZodString;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        limit: number;
        projectId: string;
    }, {
        projectId: string;
        limit?: number | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
