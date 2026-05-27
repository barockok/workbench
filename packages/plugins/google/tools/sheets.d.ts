import { z } from "zod";
export declare const readSheet: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        spreadsheetId: z.ZodString;
        range: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        range: string;
        spreadsheetId: string;
    }, {
        range: string;
        spreadsheetId: string;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
export declare const writeSheet: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        spreadsheetId: z.ZodString;
        range: z.ZodString;
        values: z.ZodArray<z.ZodArray<z.ZodString, "many">, "many">;
    }, "strip", z.ZodTypeAny, {
        values: string[][];
        range: string;
        spreadsheetId: string;
    }, {
        values: string[][];
        range: string;
        spreadsheetId: string;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
