"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeSheet = exports.readSheet = void 0;
const zod_1 = require("zod");
exports.readSheet = {
    name: "google_sheets_read",
    description: "Read values from a Google Sheet",
    integration: "google",
    inputSchema: zod_1.z.object({
        spreadsheetId: zod_1.z.string(),
        range: zod_1.z.string(),
    }),
    handler: async (ctx, args) => {
        const res = await ctx.http(`https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheetId}/values/${encodeURIComponent(args.range)}`);
        return res.json();
    },
};
exports.writeSheet = {
    name: "google_sheets_write",
    description: "Write values to a Google Sheet",
    integration: "google",
    inputSchema: zod_1.z.object({
        spreadsheetId: zod_1.z.string(),
        range: zod_1.z.string(),
        values: zod_1.z.array(zod_1.z.array(zod_1.z.string())),
    }),
    handler: async (ctx, args) => {
        const res = await ctx.http(`https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheetId}/values/${encodeURIComponent(args.range)}?valueInputOption=RAW`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ values: args.values }),
        });
        return res.json();
    },
};
