import { z } from "zod";
export declare const sendEmail: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        to: z.ZodString;
        subject: z.ZodString;
        body: z.ZodString;
        cc: z.ZodOptional<z.ZodString>;
        bcc: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        body: string;
        to: string;
        subject: string;
        cc?: string | undefined;
        bcc?: string | undefined;
    }, {
        body: string;
        to: string;
        subject: string;
        cc?: string | undefined;
        bcc?: string | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
export declare const listEmails: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        maxResults: z.ZodDefault<z.ZodNumber>;
        query: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        maxResults: number;
        query?: string | undefined;
    }, {
        query?: string | undefined;
        maxResults?: number | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
export declare const getEmail: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
