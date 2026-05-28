import { z } from "zod";

export const listFiles = {
  name: "google_drive_list",
  description: "List files in Google Drive",
  integration: "google-drive",
  inputSchema: z.object({
    pageSize: z.number().default(10),
    query: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("pageSize", String(args.pageSize));
    if (args.query) params.set("q", args.query);

    const res = await ctx.http(`https://www.googleapis.com/drive/v3/files?${params}`);
    return res.json();
  },
};

export const createFolder = {
  name: "google_drive_create_folder",
  description: "Create a folder in Google Drive",
  integration: "google-drive",
  inputSchema: z.object({
    name: z.string(),
    parentId: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: args.name,
        mimeType: "application/vnd.google-apps.folder",
        parents: args.parentId ? [args.parentId] : undefined,
      }),
    });
    return res.json();
  },
};

export const searchFiles = {
  name: "google_drive_search",
  description: "Search files in Google Drive",
  integration: "google-drive",
  inputSchema: z.object({
    query: z.string(),
    pageSize: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("q", `name contains '${args.query}' or fullText contains '${args.query}'`);
    params.set("pageSize", String(args.pageSize));
    params.set("fields", "nextPageToken,files(id,name,mimeType,modifiedTime,size)");
    const res = await ctx.http(`https://www.googleapis.com/drive/v3/files?${params}`);
    return res.json();
  },
};

export const uploadFile = {
  name: "google_drive_upload",
  description: "Upload a file to Google Drive",
  integration: "google-drive",
  inputSchema: z.object({
    name: z.string(),
    content: z.string(),
    mimeType: z.string().default("text/plain"),
    parentId: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const metadata = {
      name: args.name,
      mimeType: args.mimeType,
      parents: args.parentId ? [args.parentId] : undefined,
    };
    const boundary = "-------314159265358979323846";
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${args.mimeType}`,
      "",
      args.content,
      `--${boundary}--`,
    ].join("\r\n");

    const res = await ctx.http("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    return res.json();
  },
};

export const downloadFile = {
  name: "google_drive_download",
  description: "Download a file from Google Drive",
  integration: "google-drive",
  inputSchema: z.object({
    fileId: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(`https://www.googleapis.com/drive/v3/files/${args.fileId}?alt=media`);
    return res.text();
  },
};

export const trashFile = {
  name: "google_drive_trash",
  description: "Move a file to trash in Google Drive",
  integration: "google-drive",
  inputSchema: z.object({
    fileId: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(`https://www.googleapis.com/drive/v3/files/${args.fileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
    return res.json();
  },
};

export const updatePermissions = {
  name: "google_drive_permissions",
  description: "Update permissions for a Google Drive file",
  integration: "google-drive",
  inputSchema: z.object({
    fileId: z.string(),
    email: z.string().email(),
    role: z.enum(["reader", "commenter", "writer", "owner"]).default("reader"),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(`https://www.googleapis.com/drive/v3/files/${args.fileId}/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: args.role,
        type: "user",
        emailAddress: args.email,
      }),
    });
    return res.json();
  },
};
