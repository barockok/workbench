"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmail = exports.listEmails = exports.sendEmail = void 0;
const zod_1 = require("zod");
exports.sendEmail = {
    name: "google_gmail_send",
    description: "Send an email via Gmail",
    integration: "google",
    inputSchema: zod_1.z.object({
        to: zod_1.z.string().email(),
        subject: zod_1.z.string(),
        body: zod_1.z.string(),
        cc: zod_1.z.string().email().optional(),
        bcc: zod_1.z.string().email().optional(),
    }),
    handler: async (ctx, args) => {
        const raw = Buffer.from(`To: ${args.to}\nSubject: ${args.subject}\n\n${args.body}`).toString("base64url");
        const res = await ctx.http("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ raw }),
        });
        return res.json();
    },
};
exports.listEmails = {
    name: "google_gmail_list",
    description: "List emails from Gmail inbox",
    integration: "google",
    inputSchema: zod_1.z.object({
        maxResults: zod_1.z.number().default(10),
        query: zod_1.z.string().optional(),
    }),
    handler: async (ctx, args) => {
        const params = new URLSearchParams();
        params.set("maxResults", String(args.maxResults));
        if (args.query)
            params.set("q", args.query);
        const res = await ctx.http(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
        return res.json();
    },
};
exports.getEmail = {
    name: "google_gmail_get",
    description: "Get a specific email by ID",
    integration: "google",
    inputSchema: zod_1.z.object({
        id: zod_1.z.string(),
    }),
    handler: async (ctx, args) => {
        const res = await ctx.http(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.id}`);
        return res.json();
    },
};
