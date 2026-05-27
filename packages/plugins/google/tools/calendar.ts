import { z } from "zod";

export const listEvents = {
  name: "google_calendar_list_events",
  description: "List events from Google Calendar",
  integration: "google",
  inputSchema: z.object({
    calendarId: z.string().default("primary"),
    maxResults: z.number().default(10),
    timeMin: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("maxResults", String(args.maxResults));
    if (args.timeMin) params.set("timeMin", args.timeMin);

    const res = await ctx.http(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events?${params}`
    );
    return res.json();
  },
};

export const createEvent = {
  name: "google_calendar_create_event",
  description: "Create an event in Google Calendar",
  integration: "google",
  inputSchema: z.object({
    calendarId: z.string().default("primary"),
    summary: z.string(),
    start: z.object({ dateTime: z.string() }),
    end: z.object({ dateTime: z.string() }),
    description: z.string().optional(),
    attendees: z.array(z.object({ email: z.string() })).optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const { calendarId, ...body } = args;
    const res = await ctx.http(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    return res.json();
  },
};
