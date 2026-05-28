import { z } from "zod";

export const readSheet = {
  name: "google_sheets_read",
  description: "Read values from a Google Sheet",
  integration: "google-sheets",
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
  integration: "google-sheets",
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

export const createSpreadsheet = {
  name: "google_sheets_create",
  description: "Create a new Google Spreadsheet",
  integration: "google-sheets",
  inputSchema: z.object({
    title: z.string(),
    sheets: z.array(z.string()).optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const body: any = { properties: { title: args.title } };
    if (args.sheets) {
      body.sheets = args.sheets.map((name: string) => ({ properties: { title: name } }));
    }
    const res = await ctx.http("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
};

export const searchSheets = {
  name: "google_sheets_search",
  description: "Search for Google Sheets in Drive",
  integration: "google-sheets",
  inputSchema: z.object({
    query: z.string(),
    pageSize: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    params.set("q", `mimeType='application/vnd.google-apps.spreadsheet' and name contains '${args.query}'`);
    params.set("pageSize", String(args.pageSize));
    params.set("fields", "nextPageToken,files(id,name,modifiedTime)");
    const res = await ctx.http(`https://www.googleapis.com/drive/v3/files?${params}`);
    return res.json();
  },
};
