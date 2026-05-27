import { z } from "zod";

export const readSheet = {
  name: "google_sheets_read",
  description: "Read values from a Google Sheet",
  integration: "google",
  inputSchema: z.object({
    spreadsheetId: z.string(),
    range: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(
      `https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheetId}/values/${encodeURIComponent(args.range)}`
    );
    return res.json();
  },
};

export const writeSheet = {
  name: "google_sheets_write",
  description: "Write values to a Google Sheet",
  integration: "google",
  inputSchema: z.object({
    spreadsheetId: z.string(),
    range: z.string(),
    values: z.array(z.array(z.string())),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(
      `https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheetId}/values/${encodeURIComponent(args.range)}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: args.values }),
      }
    );
    return res.json();
  },
};
