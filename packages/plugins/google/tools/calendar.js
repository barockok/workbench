"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEvent = exports.listEvents = void 0;
const zod_1 = require("zod");
exports.listEvents = {
    name: "google_calendar_list_events",
    description: "List events from Google Calendar",
    integration: "google",
    inputSchema: zod_1.z.object({
        calendarId: zod_1.z.string().default("primary"),
        maxResults: zod_1.z.number().default(10),
        timeMin: zod_1.z.string().optional(),
    }),
    handler: async (ctx, args) => {
        const params = new URLSearchParams();
        params.set("maxResults", String(args.maxResults));
        if (args.timeMin)
            params.set("timeMin", args.timeMin);
        const res = await ctx.http(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events?${params}`);
        return res.json();
    },
};
exports.createEvent = {
    name: "google_calendar_create_event",
    description: "Create an event in Google Calendar",
    integration: "google",
    inputSchema: zod_1.z.object({
        calendarId: zod_1.z.string().default("primary"),
        summary: zod_1.z.string(),
        start: zod_1.z.object({ dateTime: zod_1.z.string() }),
        end: zod_1.z.object({ dateTime: zod_1.z.string() }),
        description: zod_1.z.string().optional(),
        attendees: zod_1.z.array(zod_1.z.object({ email: zod_1.z.string() })).optional(),
    }),
    handler: async (ctx, args) => {
        const { calendarId, ...body } = args;
        const res = await ctx.http(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return res.json();
    },
};
