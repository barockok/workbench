import { z } from "zod";
export declare const createPage: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        spaceKey: z.ZodString;
        title: z.ZodString;
        body: z.ZodString;
        parentId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        body: string;
        spaceKey: string;
        title: string;
        parentId?: string | undefined;
    }, {
        body: string;
        spaceKey: string;
        title: string;
        parentId?: string | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
export declare const searchPages: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        query: z.ZodString;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        query: string;
        limit: number;
    }, {
        query: string;
        limit?: number | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
