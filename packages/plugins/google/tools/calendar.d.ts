import { z } from "zod";
export declare const listEvents: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        calendarId: z.ZodDefault<z.ZodString>;
        maxResults: z.ZodDefault<z.ZodNumber>;
        timeMin: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        maxResults: number;
        calendarId: string;
        timeMin?: string | undefined;
    }, {
        maxResults?: number | undefined;
        calendarId?: string | undefined;
        timeMin?: string | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
export declare const createEvent: {
    name: string;
    description: string;
    integration: string;
    inputSchema: z.ZodObject<{
        calendarId: z.ZodDefault<z.ZodString>;
        summary: z.ZodString;
        start: z.ZodObject<{
            dateTime: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            dateTime: string;
        }, {
            dateTime: string;
        }>;
        end: z.ZodObject<{
            dateTime: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            dateTime: string;
        }, {
            dateTime: string;
        }>;
        description: z.ZodOptional<z.ZodString>;
        attendees: z.ZodOptional<z.ZodArray<z.ZodObject<{
            email: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            email: string;
        }, {
            email: string;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        calendarId: string;
        summary: string;
        start: {
            dateTime: string;
        };
        end: {
            dateTime: string;
        };
        description?: string | undefined;
        attendees?: {
            email: string;
        }[] | undefined;
    }, {
        summary: string;
        start: {
            dateTime: string;
        };
        end: {
            dateTime: string;
        };
        calendarId?: string | undefined;
        description?: string | undefined;
        attendees?: {
            email: string;
        }[] | undefined;
    }>;
    handler: (ctx: any, args: any) => Promise<any>;
};
