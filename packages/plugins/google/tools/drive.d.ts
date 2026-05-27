import { z } from "zod";
export declare const listFiles: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        pageSize: z.ZodDefault<z.ZodNumber>;
        query: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        pageSize: number;
        query?: string | undefined;
    }, {
        query?: string | undefined;
        pageSize?: number | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
export declare const createFolder: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        name: z.ZodString;
        parentId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        parentId?: string | undefined;
    }, {
        name: string;
        parentId?: string | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
