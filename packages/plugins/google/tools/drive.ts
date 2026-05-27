import { z } from "zod";

export const listFiles = {
  name: "google_drive_list",
  description: "List files in Google Drive",
  integration: "google",
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
  integration: "google",
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
