import { z } from "zod";
export declare const listRepos: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        type: z.ZodDefault<z.ZodEnum<["all", "owner", "member"]>>;
        perPage: z.ZodDefault<z.ZodNumber>;
        page: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: "all" | "owner" | "member";
        page: number;
        perPage: number;
    }, {
        type?: "all" | "owner" | "member" | undefined;
        page?: number | undefined;
        perPage?: number | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
export declare const createIssue: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        owner: z.ZodString;
        repo: z.ZodString;
        title: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
        labels: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        repo: string;
        owner: string;
        body?: string | undefined;
        labels?: string[] | undefined;
    }, {
        title: string;
        repo: string;
        owner: string;
        body?: string | undefined;
        labels?: string[] | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
export declare const createPR: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        owner: z.ZodString;
        repo: z.ZodString;
        title: z.ZodString;
        head: z.ZodString;
        base: z.ZodString;
        body: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        head: string;
        title: string;
        repo: string;
        owner: string;
        base: string;
        body?: string | undefined;
    }, {
        head: string;
        title: string;
        repo: string;
        owner: string;
        base: string;
        body?: string | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
