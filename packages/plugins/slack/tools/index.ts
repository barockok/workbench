import { z } from "zod";

export const sendMessage = {
  name: "slack_send_message",
  description: "Send a message to a Slack channel",
  integration: "slack",
  inputSchema: z.object({
    channel: z.string(),
    text: z.string(),
    threadTs: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const body: any = {
      channel: args.channel,
      text: args.text,
    };
    if (args.threadTs) body.thread_ts = args.threadTs;

    const res = await ctx.http("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
};

export const listChannels = {
  name: "slack_list_channels",
  description: "List Slack channels",
  integration: "slack",
  inputSchema: z.object({
    limit: z.number().default(100),
    types: z.string().default("public_channel"),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("limit", String(args.limit));
    params.set("types", args.types);
    const res = await ctx.http(`https://slack.com/api/conversations.list?${params}`);
    return res.json();
  },
};

export const getChannelHistory = {
  name: "slack_get_channel_history",
  description: "Get message history from a Slack channel",
  integration: "slack",
  inputSchema: z.object({
    channel: z.string(),
    limit: z.number().default(100),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("channel", args.channel);
    params.set("limit", String(args.limit));
    const res = await ctx.http(`https://slack.com/api/conversations.history?${params}`);
    return res.json();
  },
};

export const uploadFile = {
  name: "slack_upload_file",
  description: "Upload a file to a Slack channel",
  integration: "slack",
  inputSchema: z.object({
    channel: z.string(),
    content: z.string(),
    filename: z.string(),
    title: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const formData = new FormData();
    formData.append("channels", args.channel);
    formData.append("content", args.content);
    formData.append("filename", args.filename);
    if (args.title) formData.append("title", args.title);

    const res = await ctx.http("https://slack.com/api/files.upload", {
      method: "POST",
      body: formData,
    });
    return res.json();
  },
};
