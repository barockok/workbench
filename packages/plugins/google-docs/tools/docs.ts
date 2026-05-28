import { z } from "zod";

export const getDocument = {
  name: "google_docs_get",
  description: "Get a Google Doc by ID (returns full document structure)",
  integration: "google-docs",
  inputSchema: z.object({
    documentId: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(
      `https://docs.googleapis.com/v1/documents/${args.documentId}`
    );
    return res.json();
  },
};

export const getDocumentPlaintext = {
  name: "google_docs_get_plaintext",
  description: "Get a Google Doc as plain text by ID",
  integration: "google-docs",
  inputSchema: z.object({
    documentId: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(
      `https://docs.googleapis.com/v1/documents/${args.documentId}?suggestionsViewMode=DEFAULT_FOR_CURRENT_ACCESS`
    );
    const data = await res.json();
    // Extract plain text from document body
    let text = "";
    function extractText(element: any) {
      if (element.textRun?.content) text += element.textRun.content;
      if (element.paragraph?.elements) element.paragraph.elements.forEach(extractText);
      if (element.table?.tableRows) {
        element.table.tableRows.forEach((row: any) => {
          row.tableCells?.forEach((cell: any) => {
            cell.content?.forEach(extractText);
          });
        });
      }
      if (element.sectionBreak) return;
    }
    data.body?.content?.forEach(extractText);
    return { documentId: args.documentId, title: data.title, text };
  },
};

export const createDocument = {
  name: "google_docs_create",
  description: "Create a new Google Doc",
  integration: "google-docs",
  inputSchema: z.object({
    title: z.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http("https://docs.googleapis.com/v1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: args.title }),
    });
    return res.json();
  },
};

export const batchUpdate = {
  name: "google_docs_batch_update",
  description: "Apply batch updates to a Google Doc (insert text, delete content, format, etc.)",
  integration: "google-docs",
  inputSchema: z.object({
    documentId: z.string(),
    requests: z.array(z.record(z.any())),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http(
      `https://docs.googleapis.com/v1/documents/${args.documentId}:batchUpdate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests: args.requests }),
      }
    );
    return res.json();
  },
};

export const searchDocuments = {
  name: "google_docs_search",
  description: "Search for Google Docs in Drive",
  integration: "google-docs",
  inputSchema: z.object({
    query: z.string().optional(),
    pageSize: z.number().default(10),
    orderBy: z.string().default("modifiedTime desc"),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams();
    const q = args.query
      ? `mimeType='application/vnd.google-apps.document' and name contains '${args.query}'`
      : "mimeType='application/vnd.google-apps.document'";
    params.set("q", q);
    params.set("pageSize", String(args.pageSize));
    params.set("orderBy", args.orderBy);
    params.set("fields", "nextPageToken,files(id,name,modifiedTime,webViewLink)");
    const res = await ctx.http(`https://www.googleapis.com/drive/v3/files?${params}`);
    return res.json();
  },
};
