import { z } from "zod";
export declare const createIssue: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        projectKey: z.ZodString;
        summary: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        issueType: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        summary: string;
        projectKey: string;
        issueType: string;
        description?: string | undefined;
    }, {
        summary: string;
        projectKey: string;
        description?: string | undefined;
        issueType?: string | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
export declare const searchIssues: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        jql: z.ZodString;
        maxResults: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        maxResults: number;
        jql: string;
    }, {
        jql: string;
        maxResults?: number | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
export declare const getIssue: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        issueKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        issueKey: string;
    }, {
        issueKey: string;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
