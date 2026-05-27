"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFolder = exports.listFiles = void 0;
const zod_1 = require("zod");
exports.listFiles = {
    name: "google_drive_list",
    description: "List files in Google Drive",
    integration: "google",
    inputSchema: zod_1.z.object({
        pageSize: zod_1.z.number().default(10),
        query: zod_1.z.string().optional(),
    }),
    handler: async (ctx, args) => {
        const params = new URLSearchParams();
        params.set("pageSize", String(args.pageSize));
        if (args.query)
            params.set("q", args.query);
        const res = await ctx.http(`https://www.googleapis.com/drive/v3/files?${params}`);
        return res.json();
    },
};
exports.createFolder = {
    name: "google_drive_create_folder",
    description: "Create a folder in Google Drive",
    integration: "google",
    inputSchema: zod_1.z.object({
        name: zod_1.z.string(),
        parentId: zod_1.z.string().optional(),
    }),
    handler: async (ctx, args) => {
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
