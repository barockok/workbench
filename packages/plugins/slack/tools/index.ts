import { z } from "zod";

// Slim a raw Slack user object to the fields agents need — drops the profile
// blob (4 avatar URL sizes per user, status text, etc.).
function slimUser(u: any) {
  return {
    id: u.id,
    name: u.name,
    real_name: u.real_name,
    email: u.profile?.email,
    is_bot: u.is_bot,
    deleted: u.deleted,
  };
}

export const sendMessage = {
  name: "slack_send_message",
  description:
    "Send a message to a Slack channel (pass threadTs to reply in a thread). Returns the Slack response including ts — keep that ts if you may later edit (slack_update_message) or delete (slack_delete_message) the message.",
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

export const updateMessage = {
  name: "slack_update_message",
  description:
    "Edit the text of an existing Slack message — useful for updating an in-progress status message instead of posting a new one. Needs the channel and the ts returned by slack_send_message (or found in channel history). Replaces the whole text. Returns { ok, ts } on success; on failure returns Slack's {ok:false, error} body.",
  integration: "slack",
  inputSchema: z.object({
    channel: z.string(),
    ts: z.string(),
    text: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http("https://slack.com/api/chat.update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: args.channel,
        ts: args.ts,
        text: args.text,
      }),
    });
    const data = await res.json();
    if (!data.ok) return data;
    return { ok: true, ts: data.ts };
  },
};

export const deleteMessage = {
  name: "slack_delete_message",
  description:
    "DESTRUCTIVE: permanently delete a Slack message — this is irreversible, so be certain you have the right message. Needs the channel and the message ts (from the slack_send_message response or slack_get_channel_history). You can normally only delete messages you posted. Returns { ok, ts } on success; on failure returns Slack's {ok:false, error} body. To change a message's text instead, use slack_update_message.",
  integration: "slack",
  inputSchema: z.object({
    channel: z.string(),
    ts: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http("https://slack.com/api/chat.delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: args.channel,
        ts: args.ts,
      }),
    });
    const data = await res.json();
    if (!data.ok) return data;
    return { ok: true, ts: data.ts };
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
  // files.upload is dead for apps created after May 2025 (method_deprecated);
  // Slack requires the 3-step external flow: get a pre-signed URL, POST the
  // bytes to it, then complete to share into the channel.
  handler: async (ctx: any, args: any) => {
    const bytes = Buffer.from(args.content, "utf-8");

    const params = new URLSearchParams();
    params.set("filename", args.filename);
    params.set("length", String(bytes.byteLength));
    const urlRes = await ctx.http(`https://slack.com/api/files.getUploadURLExternal?${params}`);
    const urlData = await urlRes.json();
    if (!urlData.ok) return urlData;

    const uploadRes = await ctx.http(urlData.upload_url, {
      method: "POST",
      body: bytes,
    });
    if (!uploadRes.ok) {
      throw new Error(`Slack file upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
    }

    const completeRes = await ctx.http("https://slack.com/api/files.completeUploadExternal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ id: urlData.file_id, title: args.title ?? args.filename }],
        channel_id: args.channel,
      }),
    });
    return completeRes.json();
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
  description:
    "Look up a Slack user by exact email address. Returns a slim user: { id, name, real_name, email, is_bot, deleted } — use the id as the user/channel for slack_send_dm. If you only have a display name (or aren't sure of the email), use slack_find_users instead. Not-found comes back as {ok:false, error:'users_not_found'}.",
  integration: "slack",
  inputSchema: z.object({
    email: z.string().email(),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("email", args.email);
    const res = await ctx.http(`https://slack.com/api/users.lookupByEmail?${params}`);
    const data = await res.json();
    if (!data.ok || !data.user) return data;
    return { ok: true, user: slimUser(data.user) };
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
  description:
    "List users in the Slack workspace as slim rows: { id, name, real_name, email, is_bot, deleted } (default 100 per page; pass the returned next_cursor to page). Includes bots and deactivated accounts — filter on is_bot/deleted. If you're looking for one specific person, prefer slack_find_users (by name) or slack_lookup_user (by email) over paging through this.",
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
    const data = await res.json();
    if (!data.ok || !data.members) return data;
    return {
      ok: true,
      members: data.members.map(slimUser),
      next_cursor: data.response_metadata?.next_cursor || undefined,
    };
  },
};

export const findUsers = {
  name: "slack_find_users",
  description:
    "Find Slack users by name or email. Email-shaped queries try an exact lookup first, then fall back to a case-insensitive substring match on username/real name. Returns slim rows: { id, name, real_name, email, is_bot, deleted } — use the id for slack_send_dm. Searches the first 200 workspace users; use slack_list_users with cursors for an exhaustive sweep.",
  integration: "slack",
  inputSchema: z.object({
    query: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const q = args.query.toLowerCase();

    // Email-shaped query: exact lookup first. Slack reports users_not_found
    // as 200 {ok:false}, so check the body, then fall through to name search.
    if (q.includes("@")) {
      const params = new URLSearchParams();
      params.set("email", args.query);
      const res = await ctx.http(`https://slack.com/api/users.lookupByEmail?${params}`);
      const data = await res.json();
      if (data.ok && data.user) return { ok: true, members: [slimUser(data.user)] };
    }

    const params = new URLSearchParams();
    params.set("limit", "200");
    const res = await ctx.http(`https://slack.com/api/users.list?${params}`);
    const data = await res.json();
    if (!data.ok || !data.members) return data;
    const filtered = data.members.filter(
      (u: any) =>
        u.name?.toLowerCase().includes(q) ||
        u.real_name?.toLowerCase().includes(q) ||
        u.profile?.email?.toLowerCase() === q
    );
    return { ok: true, members: filtered.map(slimUser) };
  },
};
