import { describe, it, expect, vi } from "vitest";
import { searchDocuments } from "../../plugins/google-docs/tools/docs";
import { searchFiles } from "../../plugins/google-drive/tools/drive";
import { searchSlides, createFromMarkdown } from "../../plugins/google-slides/tools/slides";

// Mock ctx.http that records the URL it was called with.
function recordingCtx(jsonReply: unknown = { files: [] }) {
  const urls: string[] = [];
  const bodies: string[] = [];
  const http = vi.fn(async (url: string, init?: any) => {
    urls.push(url);
    if (init?.body) bodies.push(init.body);
    return { json: async () => jsonReply };
  });
  return { ctx: { http } as any, urls, bodies };
}

function qParam(url: string): string {
  const u = new URL(url);
  return u.searchParams.get("q") ?? "";
}

describe("Drive query safety (#8) + orderBy encoding (#7)", () => {
  it("escapes single quotes in the user query (no injection)", async () => {
    const { ctx, urls } = recordingCtx();
    await searchDocuments.handler(ctx, {
      query: "test' or trashed=true or name contains '",
      pageSize: 10,
      orderBy: "modifiedTime desc",
    });
    const q = qParam(urls[0]);
    // The user's quotes must be backslash-escaped so they can't break out of
    // the literal — i.e. no bare `'` from user input lands unescaped.
    expect(q).toContain("name contains 'test\\' or trashed=true or name contains \\''");
    expect(q).not.toContain("name contains 'test' or trashed=true");
  });

  it("escapes quotes in google-drive searchFiles", async () => {
    const { ctx, urls } = recordingCtx();
    await searchFiles.handler(ctx, { query: "a' or b='", pageSize: 10 });
    const q = qParam(urls[0]);
    expect(q).toContain("a\\' or b=\\'");
  });

  it("escapes quotes in google-slides searchSlides", async () => {
    const { ctx, urls } = recordingCtx();
    await searchSlides.handler(ctx, { query: "x'y", pageSize: 10, orderBy: "modifiedTime desc" });
    expect(qParam(urls[0])).toContain("x\\'y");
  });

  it("encodes orderBy space as %20, not + (Drive rejects +)", async () => {
    const { ctx, urls } = recordingCtx();
    await searchDocuments.handler(ctx, { query: undefined, pageSize: 10, orderBy: "modifiedTime desc" });
    expect(urls[0]).toContain("orderBy=modifiedTime%20desc");
    expect(urls[0]).not.toContain("orderBy=modifiedTime+desc");
  });
});

describe("createFromMarkdown inserts content (#9)", () => {
  it("adds insertText requests carrying each slide's markdown text", async () => {
    const { ctx, bodies } = recordingCtx();
    // first call creates the presentation, second is the batchUpdate
    ctx.http.mockImplementation(async (url: string, init?: any) => {
      if (url.endsWith("/presentations")) return { json: async () => ({ presentationId: "p1", title: "T" }) };
      if (init?.body) bodies.push(init.body);
      return { json: async () => ({}) };
    });

    await createFromMarkdown.handler(ctx, { title: "T", markdownText: "Hello world\n---\nSecond slide" });

    const batch = JSON.parse(bodies[bodies.length - 1]);
    const inserts = batch.requests.filter((r: any) => r.insertText);
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    const allText = inserts.map((r: any) => r.insertText.text).join("\n");
    expect(allText).toContain("Hello world");
    expect(allText).toContain("Second slide");
  });
});
