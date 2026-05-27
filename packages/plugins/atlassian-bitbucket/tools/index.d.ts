import { z } from "zod";
export declare const listRepos: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        workspace: z.ZodString;
        page: z.ZodDefault<z.ZodNumber>;
        pagelen: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        page: number;
        workspace: string;
        pagelen: number;
    }, {
        workspace: string;
        page?: number | undefined;
        pagelen?: number | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
export declare const createPR: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        workspace: z.ZodString;
        repoSlug: z.ZodString;
        title: z.ZodString;
        sourceBranch: z.ZodString;
        destinationBranch: z.ZodDefault<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        workspace: string;
        repoSlug: string;
        sourceBranch: string;
        destinationBranch: string;
        description?: string | undefined;
    }, {
        title: string;
        workspace: string;
        repoSlug: string;
        sourceBranch: string;
        description?: string | undefined;
        destinationBranch?: string | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
