import { z } from "zod";

export const listEvents = {
  name: "google_calendar_list_events",
  description: "List events from Google Calendar",
  integration: "google-calendar",
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
  integration: "google-calendar",
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

export const getEvent = {
  name: "google_calendar_get_event",
  description: "Get a specific Google Calendar event",
  integration: "google-calendar",
  inputSchema: z.object({
    calendarId: z.string().default("primary"),
    eventId: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events/${args.eventId}`
    );
    return res.json();
  },
};

export const updateEvent = {
  name: "google_calendar_update_event",
  description: "Update a Google Calendar event",
  integration: "google-calendar",
  inputSchema: z.object({
    calendarId: z.string().default("primary"),
    eventId: z.string(),
    summary: z.string().optional(),
    start: z.object({ dateTime: z.string() }).optional(),
    end: z.object({ dateTime: z.string() }).optional(),
    description: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const { calendarId, eventId, ...body } = args;
    const res = await ctx.http(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    return res.json();
  },
};

export const deleteEvent = {
  name: "google_calendar_delete_event",
  description: "Delete a Google Calendar event",
  integration: "google-calendar",
  inputSchema: z.object({
    calendarId: z.string().default("primary"),
    eventId: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events/${args.eventId}`,
      { method: "DELETE" }
    );
    if (res.status === 204) return { success: true };
    return res.json();
  },
};

export const listCalendars = {
  name: "google_calendar_list_calendars",
  description: "List all Google Calendars for the user",
  integration: "google-calendar",
  inputSchema: z.object({
    maxResults: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("maxResults", String(args.maxResults));
    const res = await ctx.http(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`);
    return res.json();
  },
};
