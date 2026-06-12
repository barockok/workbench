import { describe, it, expect, vi } from "vitest";
import { getPage, searchPages, listSpaces, updatePage } from "../../plugins/atlassian-confluence/tools/index";

function recordingCtx(jsonReply: unknown) {
  const urls: string[] = [];
  const bodies: string[] = [];
  const http = vi.fn(async (url: string, init?: any) => {
    urls.push(url);
    if (init?.body) bodies.push(init.body);
    return { json: async () => jsonReply, status: 200 };
  });
  return { ctx: { http } as any, urls, bodies };
}

describe("confluence_get_page (v1 GET removed → CQL search)", () => {
  it("fetches via the content/search CQL endpoint, not the removed /content/{id}", async () => {
    const { ctx, urls } = recordingCtx({
      results: [
        {
          id: "123",
          type: "page",
          status: "current",
          title: "T",
          space: { key: "ENG" },
          version: { number: 7 },
          body: { storage: { value: "<p>hi</p>" } },
          _links: { webui: "/spaces/ENG/pages/123" },
        },
      ],
    });
    const out = await getPage.handler(ctx, { pageId: "123" });
    expect(urls[0]).toContain("/wiki/rest/api/content/search?");
    expect(urls[0]).toContain("cql=id%3D123");
    expect(urls[0]).not.toContain("/content/123");
    expect(out).toMatchObject({ id: "123", title: "T", spaceKey: "ENG", version: 7, body: "<p>hi</p>" });
  });

  it("returns an error object when the page is missing", async () => {
    const { ctx } = recordingCtx({ results: [] });
    const out = await getPage.handler(ctx, { pageId: "999" });
    expect(out.error).toContain("999");
  });
});

describe("confluence_search_pages", () => {
  it("escapes quotes in the CQL text literal", async () => {
    const { ctx, urls } = recordingCtx({ results: [] });
    await searchPages.handler(ctx, { query: 'a" or type=space or text ~ "', limit: 5 });
    const cql = new URL(urls[0]).searchParams.get("cql")!;
    expect(cql).toContain('\\"');
    expect(cql).not.toContain('text ~ "a" or');
  });

  it("slims the result rows", async () => {
    const { ctx } = recordingCtx({
      results: [
        {
          id: "1",
          type: "page",
          status: "current",
          title: "A",
          space: { key: "ENG" },
          version: { number: 2 },
          _links: { webui: "/x" },
          _expandable: { junk: "yes" },
          breadcrumbs: [],
        },
      ],
      size: 1,
      _links: {},
    });
    const out = await searchPages.handler(ctx, { query: "a", limit: 5 });
    expect(out.results[0]).toEqual({
      id: "1",
      type: "page",
      status: "current",
      title: "A",
      spaceKey: "ENG",
      version: 2,
      url: "/x",
    });
    expect(out.hasMore).toBe(false);
  });
});

describe("confluence_list_spaces", () => {
  it("slims space rows from the generic search envelope", async () => {
    const { ctx } = recordingCtx({
      results: [{ space: { key: "ENG", name: "Engineering" }, title: "Engineering", url: "/spaces/ENG" }],
      size: 1,
    });
    const out = await listSpaces.handler(ctx, { limit: 25 });
    expect(out.results[0]).toEqual({ key: "ENG", name: "Engineering", url: "/spaces/ENG" });
  });
});

describe("confluence_update_page", () => {
  it("sends version+1 (input is the CURRENT version from get_page)", async () => {
    const { ctx, bodies } = recordingCtx({ id: "1", title: "T" });
    await updatePage.handler(ctx, { pageId: "1", title: "T", body: "b", version: 7 });
    expect(JSON.parse(bodies[0]).version.number).toBe(8);
  });
});
