import { z } from "zod";
export declare const generateContent: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        prompt: z.ZodString;
        model: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        prompt: string;
        model: string;
    }, {
        prompt: string;
        model?: string | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
