import { describe, it, expect, vi } from "vitest";
import {
  createPage,
  getPage,
  searchPages,
  listSpaces,
  updatePage,
  deletePage,
} from "../../plugins/atlassian-confluence/tools/index";

// A ctx whose http() routes by URL → { ok, status, json }. Each route is
// [substring, reply]; first match wins. Records urls + request bodies.
function routedCtx(routes: Array<[string, any]>, status = 200) {
  const urls: string[] = [];
  const bodies: string[] = [];
  const http = vi.fn(async (url: string, init?: any) => {
    urls.push(url);
    if (init?.body) bodies.push(init.body);
    const hit = routes.find(([frag]) => url.includes(frag));
    const reply = hit ? hit[1] : {};
    const st = init?.method === "DELETE" ? 204 : status;
    return {
      ok: st >= 200 && st < 300,
      status: st,
      json: async () => reply,
      text: async () => JSON.stringify(reply),
    };
  });
  // Unique userId per ctx so the module-level space cache never bleeds between tests.
  return { ctx: { http, userId: `u-${urls.length}-${Math.random()}` } as any, urls, bodies };
}

describe("confluence_create_page (v2)", () => {
  it("resolves spaceKey→spaceId, POSTs to v2 /pages with the v2 body wrapper", async () => {
    const { ctx, urls, bodies } = routedCtx([
      ["/api/v2/spaces?", { results: [{ id: "98765", key: "ENG" }] }],
      ["/api/v2/pages", {
        id: "1234567890123",
        status: "current",
        title: "New",
        spaceId: "98765",
        version: { number: 1 },
        _links: { webui: "/spaces/ENG/pages/1234567890123" },
      }],
    ]);
    const out = await createPage.handler(ctx, { spaceKey: "ENG", title: "New", body: "<p>hi</p>" });

    expect(urls[0]).toContain("/wiki/api/v2/spaces?");
    expect(urls[0]).toContain("keys=ENG");
    const postUrl = urls.find((u) => u.endsWith("/api/v2/pages"))!;
    expect(postUrl).toContain("/wiki/api/v2/pages");
    const sent = JSON.parse(bodies[0]);
    expect(sent).toMatchObject({
      spaceId: "98765",
      status: "current",
      title: "New",
      body: { representation: "storage", value: "<p>hi</p>" },
    });
    // spaceKey came from create input → no reverse lookup needed.
    expect(out).toMatchObject({ id: "1234567890123", title: "New", spaceKey: "ENG", version: 1 });
  });

  it("skips the space lookup when spaceId is passed", async () => {
    const { ctx, urls, bodies } = routedCtx([
      ["/api/v2/pages", { id: "9", spaceId: "55", title: "T", version: { number: 1 } }],
    ]);
    await createPage.handler(ctx, { spaceKey: "ENG", spaceId: "55", title: "T", body: "b" });
    expect(urls.some((u) => u.includes("/spaces?"))).toBe(false);
    expect(JSON.parse(bodies[0]).spaceId).toBe("55");
  });

  it("throws with the real status on a non-2xx (no silent success)", async () => {
    const { ctx } = routedCtx(
      [["/api/v2/spaces?", { results: [{ id: "1", key: "ENG" }] }], ["/api/v2/pages", { errors: [{ title: "boom" }] }]],
      400
    );
    await expect(createPage.handler(ctx, { spaceKey: "ENG", title: "T", body: "b" })).rejects.toThrow(/HTTP 400/);
  });
});

describe("confluence_get_page (v2)", () => {
  it("GETs v2 /pages/{id}?body-format=storage and maps the storage body", async () => {
    const { ctx, urls } = routedCtx([
      ["/api/v2/pages/123", {
        id: "123",
        status: "current",
        title: "T",
        spaceId: "98765",
        version: { number: 7 },
        body: { storage: { value: "<p>hi</p>", representation: "storage" } },
        _links: { webui: "/spaces/ENG/pages/123" },
      }],
      ["/api/v2/spaces/98765", { id: "98765", key: "ENG" }],
    ]);
    const out = await getPage.handler(ctx, { pageId: "123" });
    expect(urls[0]).toContain("/wiki/api/v2/pages/123?body-format=storage");
    expect(urls[0]).not.toContain("/rest/api/content");
    expect(out).toMatchObject({ id: "123", title: "T", spaceKey: "ENG", version: 7, body: "<p>hi</p>" });
  });

  it("returns an error object on 404", async () => {
    const { ctx } = routedCtx([["/api/v2/pages/999", {}]], 404);
    const out = await getPage.handler(ctx, { pageId: "999" });
    expect(out.error).toContain("999");
  });
});

describe("confluence_search_pages (v2 → CQL search)", () => {
  it("escapes quotes in the CQL text literal and scopes to type=page", async () => {
    const { ctx, urls } = routedCtx([["/rest/api/search", { results: [] }]]);
    await searchPages.handler(ctx, { query: 'a" or type=space or text ~ "', limit: 5 });
    expect(urls[0]).toContain("/wiki/rest/api/search?");
    const cql = new URL(urls[0]).searchParams.get("cql")!;
    expect(cql).toContain("type=page");
    expect(cql).toContain('\\"');
    expect(cql).not.toContain('text ~ "a" or');
  });

  it("slims page hits out of the generic search envelope (content nesting)", async () => {
    const { ctx } = routedCtx([
      ["/rest/api/search", {
        results: [
          {
            content: { id: "1", type: "page", status: "current", title: "A", space: { key: "ENG" }, version: { number: 2 } },
            url: "/x",
          },
        ],
        size: 1,
        _links: {},
      }],
    ]);
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

  // The whole point of F1: a caller-built CQL string must reach Confluence
  // intact. Previously it landed in `query` and was matched as literal text —
  // near-zero hits, no error, so callers concluded "nothing found".
  it("passes a caller's cql through verbatim, without the type=page wrapper", async () => {
    const { ctx, urls } = routedCtx([["/rest/api/search", { results: [] }]]);
    const cql = 'space = ENG AND label = "adr" ORDER BY lastmodified DESC';
    await searchPages.handler(ctx, { cql, limit: 5 });
    expect(new URL(urls[0]).searchParams.get("cql")).toBe(cql);
  });

  it("prefers cql over query when both are given", async () => {
    const { ctx, urls } = routedCtx([["/rest/api/search", { results: [] }]]);
    await searchPages.handler(ctx, { query: "ignored", cql: "label = \"adr\"", limit: 5 });
    const sent = new URL(urls[0]).searchParams.get("cql")!;
    expect(sent).toBe('label = "adr"');
    expect(sent).not.toContain("ignored");
  });

  it("rejects a call with neither query nor cql", async () => {
    const { ctx } = routedCtx([["/rest/api/search", { results: [] }]]);
    await expect(searchPages.handler(ctx, { limit: 5 })).rejects.toThrow(/query|cql/);
  });

  it("caps limit so a bad value fails loudly instead of scanning unbounded", () => {
    expect(searchPages.inputSchema.safeParse({ query: "a", limit: 500 }).success).toBe(false);
    expect(searchPages.inputSchema.safeParse({ query: "a", limit: 100 }).success).toBe(true);
  });

  // A malformed CQL string must surface the upstream 400, not an empty list —
  // that is what converts P1 from silently-wrong to loudly-broken.
  it("throws on an upstream CQL error rather than returning empty results", async () => {
    const { ctx } = routedCtx([["/rest/api/search", { message: "Could not parse cql" }]], 400);
    await expect(searchPages.handler(ctx, { cql: "space = = ENG", limit: 5 })).rejects.toThrow(
      /400/
    );
  });
});

describe("confluence_get_page attachments", () => {
  it("lists attachments alongside the body so diagram-only sections aren't silent gaps", async () => {
    const { ctx, urls } = routedCtx([
      // Ordered before the page route: both URLs share the /pages/123 prefix.
      ["/pages/123/attachments", {
        results: [
          {
            id: "att1",
            title: "architecture.drawio.png",
            mediaType: "image/png",
            fileSize: 20480,
            downloadLink: "/download/attachments/123/architecture.drawio.png",
            webuiLink: "/pages/viewpageattachments.action?pageId=123",
          },
        ],
      }],
      ["/api/v2/pages/123", {
        id: "123",
        title: "T",
        spaceId: "98765",
        version: { number: 7 },
        body: { storage: { value: "<p>see diagram</p>" } },
      }],
      ["/api/v2/spaces/98765", { id: "98765", key: "ENG" }],
    ]);
    const out = await getPage.handler(ctx, { pageId: "123" });

    expect(urls.some((u) => u.includes("/pages/123/attachments"))).toBe(true);
    expect(out.attachments).toEqual([
      {
        id: "att1",
        title: "architecture.drawio.png",
        mediaType: "image/png",
        fileSize: 20480,
        downloadUrl: "/download/attachments/123/architecture.drawio.png",
        url: "/pages/viewpageattachments.action?pageId=123",
      },
    ]);
    expect(out.body).toBe("<p>see diagram</p>");
  });

  // Models a token minted before read:attachment:confluence: the page reads
  // fine, only the attachment call 403s. The page must still come back, with
  // `attachments` absent rather than a misleading [].
  it("omits attachments when the lookup 403s, keeping the page usable", async () => {
    const http = vi.fn(async (url: string) => {
      if (url.includes("/attachments")) {
        return { ok: false, status: 403, json: async () => ({}), text: async () => "" };
      }
      if (url.includes("/spaces/")) {
        return { ok: true, status: 200, json: async () => ({ id: "98765", key: "ENG" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "123",
          title: "T",
          spaceId: "98765",
          version: { number: 7 },
          body: { storage: { value: "<p>hi</p>" } },
        }),
      };
    });
    const out = await getPage.handler({ http, userId: "u-403" } as any, { pageId: "123" });

    expect(out).toMatchObject({ id: "123", title: "T", body: "<p>hi</p>" });
    expect("attachments" in out).toBe(false);
  });
});

describe("confluence_list_spaces (v2)", () => {
  it("slims rows from the v2 /spaces envelope and reports cursor pagination", async () => {
    const { ctx, urls } = routedCtx([
      ["/api/v2/spaces", {
        results: [{ id: "98765", key: "ENG", name: "Engineering", _links: { webui: "/spaces/ENG" } }],
        _links: { next: "/wiki/api/v2/spaces?cursor=abc" },
      }],
    ]);
    const out = await listSpaces.handler(ctx, { limit: 25 });
    expect(urls[0]).toContain("/wiki/api/v2/spaces");
    expect(out.results[0]).toEqual({ id: "98765", key: "ENG", name: "Engineering", url: "/spaces/ENG" });
    expect(out.hasMore).toBe(true);
  });
});

describe("confluence_update_page (v2)", () => {
  it("PUTs v2 /pages/{id} with id+status+version.number = current+1", async () => {
    const { ctx, urls, bodies } = routedCtx([
      ["/api/v2/pages/1", { id: "1", title: "T", spaceId: "55", version: { number: 8 } }],
      ["/api/v2/spaces/55", { id: "55", key: "ENG" }],
    ]);
    await updatePage.handler(ctx, { pageId: "1", title: "T", body: "b", version: 7, message: "tweak" });
    expect(urls[0]).toContain("/wiki/api/v2/pages/1");
    const sent = JSON.parse(bodies[0]);
    expect(sent).toMatchObject({
      id: "1",
      status: "current",
      title: "T",
      body: { representation: "storage", value: "b" },
      version: { number: 8, message: "tweak" },
    });
  });
});

describe("confluence_delete_page (v2)", () => {
  it("DELETEs v2 /pages/{id} and reports success on 204", async () => {
    const { ctx, urls } = routedCtx([["/api/v2/pages/1", {}]]);
    const out = await deletePage.handler(ctx, { pageId: "1" });
    expect(urls[0]).toContain("/wiki/api/v2/pages/1");
    expect(out).toEqual({ success: true });
  });
});
