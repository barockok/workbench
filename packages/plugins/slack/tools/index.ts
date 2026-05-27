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

export const addReaction = {
  name: "slack_add_reaction",
  description: "Add a reaction emoji to a Slack message",
  integration: "slack",
  inputSchema: z.object({
    channel: z.string(),
    timestamp: z.string(),
    emoji: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: args.channel,
        timestamp: args.timestamp,
        name: args.emoji,
      }),
    });
    return res.json();
  },
};

export const getThreadReplies = {
  name: "slack_get_thread_replies",
  description: "Get replies in a Slack thread",
  integration: "slack",
  inputSchema: z.object({
    channel: z.string(),
    threadTs: z.string(),
    limit: z.number().default(100),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("channel", args.channel);
    params.set("ts", args.threadTs);
    params.set("limit", String(args.limit));
    const res = await ctx.http(`https://slack.com/api/conversations.replies?${params}`);
    return res.json();
  },
};

export const lookupUser = {
  name: "slack_lookup_user",
  description: "Look up a Slack user by email",
  integration: "slack",
  inputSchema: z.object({
    email: z.string().email(),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("email", args.email);
    const res = await ctx.http(`https://slack.com/api/users.lookupByEmail?${params}`);
    return res.json();
  },
};

export const sendDM = {
  name: "slack_send_dm",
  description: "Send a direct message to a Slack user",
  integration: "slack",
  inputSchema: z.object({
    user: z.string(),
    text: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: args.user,
        text: args.text,
      }),
    });
    return res.json();
  },
};

export const searchAll = {
  name: "slack_search_all",
  description: "Search messages and files across Slack",
  integration: "slack",
  inputSchema: z.object({
    query: z.string(),
    count: z.number().default(20),
    page: z.number().default(1),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("query", args.query);
    params.set("count", String(args.count));
    params.set("page", String(args.page));
    const res = await ctx.http(`https://slack.com/api/search.all?${params}`);
    return res.json();
  },
};

export const listUsers = {
  name: "slack_list_users",
  description: "List all users in the Slack workspace",
  integration: "slack",
  inputSchema: z.object({
    limit: z.number().default(100),
    cursor: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("limit", String(args.limit));
    if (args.cursor) params.set("cursor", args.cursor);
    const res = await ctx.http(`https://slack.com/api/users.list?${params}`);
    return res.json();
  },
};

export const findUsers = {
  name: "slack_find_users",
  description: "Find Slack users by name",
  integration: "slack",
  inputSchema: z.object({
    query: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("query", args.query);
    const res = await ctx.http(`https://slack.com/api/users.lookupByEmail?${params}`);
    if (!res.ok) {
      // Fallback to search if lookupByEmail fails
      const searchParams = new URLSearchParams();
      searchParams.set("query", args.query);
      const searchRes = await ctx.http(`https://slack.com/api/users.list?${searchParams}`);
      const data = await searchRes.json();
      if (data.members) {
        const filtered = data.members.filter((u: any) =>
          u.name?.toLowerCase().includes(args.query.toLowerCase()) ||
          u.real_name?.toLowerCase().includes(args.query.toLowerCase())
        );
        return { ok: true, members: filtered };
      }
      return data;
    }
    return res.json();
  },
};
