import { describe, it, expect, vi } from "vitest";
import { getCloneUrl as bitbucketCloneUrl } from "../../plugins/atlassian-bitbucket/tools/index";
import { getCloneUrl as githubCloneUrl } from "../../plugins/github/tools/index";

function ctxWith(token: string, workspaces: string[] = ["acme"]) {
  const urls: string[] = [];
  const http = vi.fn(async (url: string) => {
    urls.push(url);
    return { json: async () => ({ values: workspaces.map((slug) => ({ slug })) }), status: 200 };
  });
  const getToken = vi.fn(async () => token);
  return { ctx: { http, getToken } as any, urls, getToken };
}

describe("bitbucket_get_clone_url", () => {
  it("builds an x-token-auth URL with explicit workspace, no API calls", async () => {
    const { ctx, urls, getToken } = ctxWith("tok-abc");
    const out = await bitbucketCloneUrl.handler(ctx, { workspace: "myws", repoSlug: "myrepo" });
    expect(out.cloneUrl).toBe("https://x-token-auth:tok-abc@bitbucket.org/myws/myrepo.git");
    expect(getToken).toHaveBeenCalled();
    expect(urls).toHaveLength(0);
    expect(out.note).toContain("expires");
  });

  it("auto-discovers the workspace when omitted", async () => {
    const { ctx, urls } = ctxWith("tok-xyz", ["firstws"]);
    const out = await bitbucketCloneUrl.handler(ctx, { repoSlug: "r" });
    expect(urls[0]).toContain("/workspaces?pagelen=1");
    expect(out.cloneUrl).toBe("https://x-token-auth:tok-xyz@bitbucket.org/firstws/r.git");
  });
});

describe("github_get_clone_url", () => {
  it("builds an x-access-token URL", async () => {
    const { ctx, urls } = ctxWith("gh-tok");
    const out = await githubCloneUrl.handler(ctx, { owner: "barockok", repo: "workbench" });
    expect(out.cloneUrl).toBe("https://x-access-token:gh-tok@github.com/barockok/workbench.git");
    expect(urls).toHaveLength(0);
    expect(out.note).toContain("expires");
  });
});
