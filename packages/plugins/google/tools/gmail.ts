import { z } from "zod";

export const sendEmail = {
  name: "google_gmail_send",
  description: "Send an email via Gmail",
  integration: "google",
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
    cc: z.string().email().optional(),
    bcc: z.string().email().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const raw = Buffer.from(
      `To: ${args.to}\nSubject: ${args.subject}\n\n${args.body}`
    ).toString("base64url");

    const res = await ctx.http("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    return res.json();
  },
};

export const listEmails = {
  name: "google_gmail_list",
  description: "List emails from Gmail inbox",
  integration: "google",
  inputSchema: z.object({
    maxResults: z.number().default(10),
    query: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("maxResults", String(args.maxResults));
    if (args.query) params.set("q", args.query);

    const res = await ctx.http(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
    return res.json();
  },
};

export const getEmail = {
  name: "google_gmail_get",
  description: "Get a specific email by ID",
  integration: "google",
  inputSchema: z.object({
    id: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.id}`);
    return res.json();
  },
};

export const getProfile = {
  name: "google_gmail_profile",
  description: "Get Gmail user profile",
  integration: "google",
  inputSchema: z.object({}),
  handler: async (ctx: any, _args: any) => {
    const res = await ctx.http("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    return res.json();
  },
};

export const listLabels = {
  name: "google_gmail_labels",
  description: "List Gmail labels",
  integration: "google",
  inputSchema: z.object({}),
  handler: async (ctx: any, _args: any) => {
    const res = await ctx.http("https://gmail.googleapis.com/gmail/v1/users/me/labels");
    return res.json();
  },
};

export const listThreads = {
  name: "google_gmail_threads",
  description: "List Gmail threads",
  integration: "google",
  inputSchema: z.object({
    maxResults: z.number().default(10),
    query: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("maxResults", String(args.maxResults));
    if (args.query) params.set("q", args.query);
    const res = await ctx.http(`https://gmail.googleapis.com/gmail/v1/users/me/threads?${params}`);
    return res.json();
  },
};

export const createDraft = {
  name: "google_gmail_draft",
  description: "Create a Gmail draft",
  integration: "google",
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
    cc: z.string().email().optional(),
    bcc: z.string().email().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const raw = Buffer.from(
      `To: ${args.to}\nSubject: ${args.subject}\n${args.cc ? `Cc: ${args.cc}\n` : ""}${args.bcc ? `Bcc: ${args.bcc}\n` : ""}\n${args.body}`
    ).toString("base64url");

    const res = await ctx.http("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { raw } }),
    });
    return res.json();
  },
};
