import { describe, it, expect, vi } from "vitest";
import {
  createPR,
  listDefaultReviewers,
  searchUsers,
  listRepos,
  getRepo,
  listPRs,
  getPR,
  getPRDiff,
  listPRComments,
  addPRComment,
  approvePR,
  requestChanges,
  mergePR,
  declinePR,
  getFile,
  listPRCommits,
} from "../../plugins/atlassian-bitbucket/tools/index";

// Mock ctx.http that records urls/methods/bodies and replies per-URL.
function recordingCtx(reply: (url: string, init?: any) => any) {
  const urls: string[] = [];
  const methods: string[] = [];
  const bodies: string[] = [];
  const http = vi.fn(async (url: string, init?: any) => {
    urls.push(url);
    methods.push(init?.method ?? "GET");
    if (init?.body) bodies.push(init.body);
    return reply(url, init);
  });
  return { ctx: { http } as any, urls, methods, bodies };
}

const jsonRes = (payload: unknown) => ({ status: 200, json: async () => payload });
const textRes = (text: string) => ({
  status: 200,
  text: async () => text,
  json: async () => {
    throw new Error("diff endpoints return text, json() must not be called when text() exists");
  },
});

// Realistic (abridged) Bitbucket payload fixtures — full payloads carry
// links/avatars/clone arrays that the tools must strip.
const rawRepo = {
  slug: "api-server",
  name: "API Server",
  full_name: "acme/api-server",
  is_private: true,
  mainbranch: { name: "develop", type: "branch" },
  updated_on: "2026-06-10T08:00:00Z",
  description: "x".repeat(500),
  links: {
    html: { href: "https://bitbucket.org/acme/api-server" },
    avatar: { href: "https://bytebucket.org/ravatar/abc" },
    clone: [
      { name: "https", href: "https://bitbucket.org/acme/api-server.git" },
      { name: "ssh", href: "git@bitbucket.org:acme/api-server.git" },
    ],
  },
  owner: { display_name: "Acme", links: { avatar: { href: "https://..." } } },
  workspace: { slug: "acme", links: {} },
};

const rawPR = {
  id: 42,
  title: "Add rate limiter",
  description: "Implements token bucket",
  state: "OPEN",
  author: { display_name: "Test User", links: { avatar: { href: "..." } } },
  source: { branch: { name: "feat/rate-limit" }, repository: { full_name: "acme/api-server" } },
  destination: { branch: { name: "develop" } },
  participants: [
    { user: { display_name: "Reviewer One", uuid: "{abc-123}" }, approved: true, role: "REVIEWER" },
    { user: { display_name: "Reviewer Two", uuid: "{def-456}" }, approved: false, role: "REVIEWER" },
  ],
  comment_count: 3,
  task_count: 1,
  created_on: "2026-06-09T10:00:00Z",
  updated_on: "2026-06-10T12:00:00Z",
  links: { html: { href: "https://bitbucket.org/acme/api-server/pull-requests/42" } },
  summary: { raw: "...", html: "<p>...</p>" },
};

describe("bitbucket_list_repos", () => {
  it("returns slim rows, truncated description, and hasMore", async () => {
    const { ctx, urls } = recordingCtx(() =>
      jsonRes({ values: [rawRepo], next: "https://api.bitbucket.org/2.0/repositories/acme?page=2" })
    );
    const out = await listRepos.handler(ctx, { workspace: "acme", page: 1, pagelen: 10 });

    expect(urls).toEqual(["https://api.bitbucket.org/2.0/repositories/acme?page=1&pagelen=10"]);
    expect(out.hasMore).toBe(true);
    expect(out.repos).toHaveLength(1);
    const row = out.repos[0];
    expect(row).toEqual({
      slug: "api-server",
      name: "API Server",
      full_name: "acme/api-server",
      is_private: true,
      mainbranch: "develop",
      updated_on: "2026-06-10T08:00:00Z",
      description: "x".repeat(200),
    });
    // bloat must be gone
    expect(JSON.stringify(out)).not.toContain("avatar");
    expect(JSON.stringify(out)).not.toContain("clone");
  });

  it("hasMore=false when no next link", async () => {
    const { ctx } = recordingCtx(() => jsonRes({ values: [rawRepo] }));
    const out = await listRepos.handler(ctx, { workspace: "acme", page: 1, pagelen: 10 });
    expect(out.hasMore).toBe(false);
  });

  it("auto-discovers the first workspace when workspace is omitted", async () => {
    const { ctx, urls } = recordingCtx((url) => {
      if (url.includes("/workspaces"))
        return jsonRes({ values: [{ slug: "first-ws", name: "First WS" }] });
      return jsonRes({ values: [rawRepo] });
    });
    const out = await listRepos.handler(ctx, { page: 1, pagelen: 10 });

    expect(urls[0]).toBe("https://api.bitbucket.org/2.0/workspaces?pagelen=1");
    expect(urls[1]).toBe("https://api.bitbucket.org/2.0/repositories/first-ws?page=1&pagelen=10");
    expect(out.workspace).toBe("first-ws");
  });

  it("throws a clear error when the account has no workspaces", async () => {
    const { ctx } = recordingCtx(() => jsonRes({ values: [] }));
    await expect(listRepos.handler(ctx, { page: 1, pagelen: 10 })).rejects.toThrow(/workspace/i);
  });
});

describe("bitbucket_get_repo", () => {
  it("returns slim shape plus the https clone URL", async () => {
    const { ctx, urls } = recordingCtx(() => jsonRes(rawRepo));
    const out = await getRepo.handler(ctx, { workspace: "acme", repoSlug: "api-server" });

    expect(urls).toEqual(["https://api.bitbucket.org/2.0/repositories/acme/api-server"]);
    expect(out.clone_https).toBe("https://bitbucket.org/acme/api-server.git");
    expect(out.mainbranch).toBe("develop");
    expect(JSON.stringify(out)).not.toContain("git@"); // ssh clone stripped
  });
});

describe("bitbucket_list_prs", () => {
  it("returns slim PR rows with hasMore", async () => {
    const { ctx, urls } = recordingCtx(() => jsonRes({ values: [rawPR], next: "..." }));
    const out = await listPRs.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      state: "OPEN",
      page: 1,
      pagelen: 10,
    });

    expect(urls[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/pullrequests?state=OPEN&page=1&pagelen=10"
    );
    expect(out.hasMore).toBe(true);
    expect(out.prs[0]).toEqual({
      id: 42,
      title: "Add rate limiter",
      state: "OPEN",
      author: "Test User",
      source: "feat/rate-limit",
      destination: "develop",
      updated_on: "2026-06-10T12:00:00Z",
    });
  });
});

describe("bitbucket_get_pr", () => {
  it("returns detail shape with reviewers from participants and html url", async () => {
    const { ctx } = recordingCtx(() => jsonRes(rawPR));
    const out = await getPR.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      pullRequestId: 42,
    });

    expect(out).toEqual({
      id: 42,
      title: "Add rate limiter",
      description: "Implements token bucket",
      state: "OPEN",
      author: "Test User",
      source: "feat/rate-limit",
      destination: "develop",
      reviewers: [
        { display_name: "Reviewer One", uuid: "{abc-123}", approved: true },
        { display_name: "Reviewer Two", uuid: "{def-456}", approved: false },
      ],
      comment_count: 3,
      task_count: 1,
      created_on: "2026-06-09T10:00:00Z",
      updated_on: "2026-06-10T12:00:00Z",
      url: "https://bitbucket.org/acme/api-server/pull-requests/42",
    });
  });
});

describe("bitbucket_create_pr", () => {
  it("sends reviewers as [{uuid}] in the POST body when provided", async () => {
    const { ctx, urls, methods, bodies } = recordingCtx((url: string) => {
      if (url.includes("/user")) {
        return jsonRes({ uuid: "{current-user-uuid}", display_name: "Current User" });
      }
      return jsonRes(rawPR);
    });
    const out = await createPR.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      title: "Add rate limiter",
      sourceBranch: "feat/rate-limit",
      destinationBranch: "develop",
      description: "Implements token bucket",
      reviewers: ["{abc-123}", "{def-456}"],
    });

    // First call is /user (GET), second is /pullrequests (POST)
    expect(urls[0]).toBe("https://api.bitbucket.org/2.0/user");
    expect(urls[1]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/pullrequests"
    );
    expect(methods[0]).toBe("GET");
    expect(methods[1]).toBe("POST");
    expect(JSON.parse(bodies[0])).toEqual({
      title: "Add rate limiter",
      source: { branch: { name: "feat/rate-limit" } },
      destination: { branch: { name: "develop" } },
      description: "Implements token bucket",
      reviewers: [{ uuid: "{abc-123}" }, { uuid: "{def-456}" }],
    });
    expect(out.reviewers).toEqual([
      { display_name: "Reviewer One", uuid: "{abc-123}", approved: true },
      { display_name: "Reviewer Two", uuid: "{def-456}", approved: false },
    ]);
  });

  it("omits reviewers from the body when not provided", async () => {
    const { ctx, bodies } = recordingCtx(() => jsonRes(rawPR));
    await createPR.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      title: "Add rate limiter",
      sourceBranch: "feat/rate-limit",
    });

    expect(JSON.parse(bodies[0])).not.toHaveProperty("reviewers");
  });

  it("filters out PR author from reviewers list", async () => {
    const { ctx, urls, bodies } = recordingCtx((url: string) => {
      if (url.includes("/user")) {
        return jsonRes({ uuid: "{author-uuid}", display_name: "PR Author" });
      }
      return jsonRes(rawPR);
    });

    await createPR.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      title: "Add rate limiter",
      sourceBranch: "feat/rate-limit",
      destinationBranch: "develop",
      reviewers: ["{author-uuid}", "{other-uuid}"],
    });

    // First call is /user, second is /pullrequests
    expect(urls[0]).toBe("https://api.bitbucket.org/2.0/user");
    expect(urls[1]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/pullrequests"
    );
    const parsed = JSON.parse(bodies[0]);
    expect(parsed.reviewers).toEqual([{ uuid: "{other-uuid}" }]);
  });

  it("handles author UUID without braces in reviewers list", async () => {
    const { ctx, bodies } = recordingCtx((url: string) => {
      if (url.includes("/user")) {
        return jsonRes({ uuid: "{author-uuid}", display_name: "PR Author" });
      }
      return jsonRes(rawPR);
    });

    await createPR.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      title: "Add rate limiter",
      sourceBranch: "feat/rate-limit",
      reviewers: ["author-uuid", "{other-uuid}"],
    });

    const parsed = JSON.parse(bodies[0]);
    expect(parsed.reviewers).toEqual([{ uuid: "{other-uuid}" }]);
  });

  it("omits reviewers when only author is provided", async () => {
    const { ctx, bodies } = recordingCtx((url: string) => {
      if (url.includes("/user")) {
        return jsonRes({ uuid: "{author-uuid}", display_name: "PR Author" });
      }
      return jsonRes(rawPR);
    });

    await createPR.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      title: "Add rate limiter",
      sourceBranch: "feat/rate-limit",
      reviewers: ["{author-uuid}"],
    });

    const parsed = JSON.parse(bodies[0]);
    expect(parsed).not.toHaveProperty("reviewers");
  });

  it("warns when author is excluded from reviewers", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { ctx } = recordingCtx((url: string) => {
      if (url.includes("/user")) {
        return jsonRes({ uuid: "{author-uuid}", display_name: "PR Author" });
      }
      return jsonRes(rawPR);
    });

    await createPR.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      title: "Add rate limiter",
      sourceBranch: "feat/rate-limit",
      reviewers: ["{author-uuid}", "{other-uuid}"],
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Excluded PR author from reviewers")
    );
    consoleSpy.mockRestore();
  });

  it("does not call /user when no reviewers provided", async () => {
    const { ctx, urls } = recordingCtx(() => jsonRes(rawPR));
    await createPR.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      title: "Add rate limiter",
      sourceBranch: "feat/rate-limit",
    });

    // Should NOT call /user endpoint
    expect(urls.every((u) => !u.includes("/user"))).toBe(true);
  });
});

describe("bitbucket_list_default_reviewers", () => {
  it("returns slim rows with uuid and reviewer_type", async () => {
    const { ctx, urls } = recordingCtx(() =>
      jsonRes({
        pagelen: 100,
        size: 2,
        page: 1,
        values: [
          {
            type: "default_reviewer",
            reviewer_type: "project",
            user: { display_name: "Patrick Wolf", uuid: "{9565301a}" },
          },
          {
            type: "default_reviewer",
            reviewer_type: "repository",
            user: { display_name: "Davis Lee", uuid: "{f0e0e8e9}" },
          },
        ],
      })
    );
    const out = await listDefaultReviewers.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
    });

    expect(urls[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/effective-default-reviewers?pagelen=100"
    );
    expect(out.reviewers).toEqual([
      { display_name: "Patrick Wolf", uuid: "{9565301a}", reviewer_type: "project" },
      { display_name: "Davis Lee", uuid: "{f0e0e8e9}", reviewer_type: "repository" },
    ]);
  });

  it("returns empty array when no default reviewers configured", async () => {
    const { ctx } = recordingCtx(() =>
      jsonRes({ pagelen: 100, size: 0, page: 1, values: [] })
    );
    const out = await listDefaultReviewers.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
    });
    expect(out.reviewers).toEqual([]);
  });
});

describe("bitbucket_search_users", () => {
  const rawMembers = {
    pagelen: 50,
    size: 3,
    page: 1,
    next: "https://api.bitbucket.org/2.0/workspaces/acme/members?page=2&pagelen=50",
    values: [
      {
        type: "workspace_membership",
        user: {
          type: "user",
          display_name: "Jane Alexander",
          nickname: "jalex",
          uuid: "{jane-uuid}",
        },
        workspace: { slug: "acme", type: "workspace" },
      },
      {
        type: "workspace_membership",
        user: {
          type: "user",
          display_name: "Alex Pemberton",
          nickname: "alexp",
          uuid: "{alex-uuid}",
        },
        workspace: { slug: "acme", type: "workspace" },
      },
      {
        type: "workspace_membership",
        user: {
          type: "user",
          display_name: "Beta No Match",
          nickname: "betano",
          uuid: "{beta-uuid}",
        },
        workspace: { slug: "acme", type: "workspace" },
      },
    ],
  };

  it("returns members matching the query by display_name or nickname", async () => {
    const { ctx, urls } = recordingCtx(() => jsonRes(rawMembers));
    const out = await searchUsers.handler(ctx, {
      workspace: "acme",
      query: "alex",
      page: 1,
      pagelen: 50,
    });

    expect(urls[0]).toBe(
      "https://api.bitbucket.org/2.0/workspaces/acme/members?page=1&pagelen=50"
    );
    expect(out.users).toEqual([
      { display_name: "Jane Alexander", nickname: "jalex", uuid: "{jane-uuid}" },
      { display_name: "Alex Pemberton", nickname: "alexp", uuid: "{alex-uuid}" },
    ]);
    expect(out.hasMore).toBe(true);
  });

  it("returns empty array when no members match", async () => {
    const { ctx } = recordingCtx(() => jsonRes(rawMembers));
    const out = await searchUsers.handler(ctx, {
      workspace: "acme",
      query: "zzz",
    });
    expect(out.users).toEqual([]);
  });

  it("filters case-insensitively", async () => {
    const { ctx } = recordingCtx(() => jsonRes(rawMembers));
    const out = await searchUsers.handler(ctx, {
      workspace: "acme",
      query: "ALEX",
    });
    expect(out.users).toHaveLength(2);
  });

  it("hasMore=false when no next link", async () => {
    const { ctx } = recordingCtx(() =>
      jsonRes({ pagelen: 50, size: 3, page: 1, values: rawMembers.values })
    );
    const out = await searchUsers.handler(ctx, {
      workspace: "acme",
      query: "alex",
    });
    expect(out.hasMore).toBe(false);
  });
});

describe("bitbucket_get_pr_diff", () => {
  it("returns the raw unified diff text via res.text()", async () => {
    const diff = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n+added line\n";
    const { ctx, urls } = recordingCtx(() => textRes(diff));
    const out = await getPRDiff.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      prId: 42,
      diffstat: false,
    });

    expect(urls).toEqual([
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/pullrequests/42/diff",
    ]);
    expect(out).toBe(diff); // passthrough, untouched
  });

  it("falls back to res.json() when the response has no text()", async () => {
    const { ctx } = recordingCtx(() => ({ status: 200, json: async () => "diff-as-json" }));
    const out = await getPRDiff.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      prId: 42,
      diffstat: false,
    });
    expect(out).toBe("diff-as-json");
  });

  it("diffstat=true hits /diffstat and returns slim per-file rows", async () => {
    const { ctx, urls } = recordingCtx(() =>
      jsonRes({
        values: [
          {
            status: "modified",
            old: { path: "src/a.ts", links: {} },
            new: { path: "src/a.ts", links: {} },
            lines_added: 10,
            lines_removed: 2,
          },
          {
            status: "added",
            old: null,
            new: { path: "src/b.ts" },
            lines_added: 30,
            lines_removed: 0,
          },
        ],
      })
    );
    const out = await getPRDiff.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      prId: 42,
      diffstat: true,
    });

    expect(urls).toEqual([
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/pullrequests/42/diffstat",
    ]);
    expect(out.files).toEqual([
      { status: "modified", old: "src/a.ts", new: "src/a.ts", lines_added: 10, lines_removed: 2 },
      { status: "added", old: undefined, new: "src/b.ts", lines_added: 30, lines_removed: 0 },
    ]);
    expect(out.hasMore).toBe(false);
  });
});

describe("bitbucket_list_pr_comments", () => {
  it("returns slim rows, inline only for inline comments", async () => {
    const { ctx, urls } = recordingCtx(() =>
      jsonRes({
        values: [
          {
            id: 1,
            user: { display_name: "Reviewer One", links: {} },
            content: { raw: "nit: rename this", html: "<p>nit</p>", markup: "markdown" },
            inline: { path: "src/a.ts", from: null, to: 12 },
            created_on: "2026-06-10T09:00:00Z",
            links: {},
          },
          {
            id: 2,
            user: { display_name: "Reviewer Two" },
            content: { raw: "LGTM overall" },
            created_on: "2026-06-10T10:00:00Z",
          },
        ],
        next: "https://api.bitbucket.org/...page=2",
      })
    );
    const out = await listPRComments.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      prId: 42,
      pagelen: 20,
    });

    expect(urls[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/pullrequests/42/comments?pagelen=20"
    );
    expect(out.hasMore).toBe(true);
    expect(out.comments[0]).toEqual({
      id: 1,
      author: "Reviewer One",
      text: "nit: rename this",
      inline: { path: "src/a.ts", line: 12 },
      created_on: "2026-06-10T09:00:00Z",
    });
    expect(out.comments[1].inline).toBeUndefined();
  });

  it("inline line falls back to `from` when `to` is null", async () => {
    const { ctx } = recordingCtx(() =>
      jsonRes({
        values: [
          {
            id: 3,
            user: { display_name: "R" },
            content: { raw: "removed line comment" },
            inline: { path: "src/a.ts", from: 7, to: null },
            created_on: "2026-06-10T11:00:00Z",
          },
        ],
      })
    );
    const out = await listPRComments.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      prId: 42,
      pagelen: 20,
    });
    expect(out.comments[0].inline).toEqual({ path: "src/a.ts", line: 7 });
  });
});

describe("bitbucket_add_pr_comment", () => {
  it("posts a general comment body and returns { id, created_on }", async () => {
    const { ctx, urls, methods, bodies } = recordingCtx(() =>
      jsonRes({ id: 99, created_on: "2026-06-12T08:00:00Z", content: { raw: "hi" }, links: {} })
    );
    const out = await addPRComment.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      prId: 42,
      text: "hi",
    });

    expect(urls[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/pullrequests/42/comments"
    );
    expect(methods[0]).toBe("POST");
    expect(JSON.parse(bodies[0])).toEqual({ content: { raw: "hi" } });
    expect(out).toEqual({ id: 99, created_on: "2026-06-12T08:00:00Z" });
  });

  it("maps inline {path, line} to Bitbucket's { inline: { path, to } }", async () => {
    const { ctx, bodies } = recordingCtx(() =>
      jsonRes({ id: 100, created_on: "2026-06-12T08:05:00Z" })
    );
    await addPRComment.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      prId: 42,
      text: "use a constant here",
      inline: { path: "src/a.ts", line: 12 },
    });

    expect(JSON.parse(bodies[0])).toEqual({
      content: { raw: "use a constant here" },
      inline: { path: "src/a.ts", to: 12 },
    });
  });
});

describe("approve / request-changes / decline", () => {
  it("approve POSTs to /approve and returns { approved: true }", async () => {
    const { ctx, urls, methods } = recordingCtx(() => jsonRes({ approved: true, user: {} }));
    const out = await approvePR.handler(ctx, { workspace: "acme", repoSlug: "api-server", prId: 42 });
    expect(urls[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/pullrequests/42/approve"
    );
    expect(methods[0]).toBe("POST");
    expect(out).toEqual({ approved: true });
  });

  it("request_changes POSTs to /request-changes and returns { requested: true }", async () => {
    const { ctx, urls, methods } = recordingCtx(() => jsonRes({ state: "changes_requested" }));
    const out = await requestChanges.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      prId: 42,
    });
    expect(urls[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/pullrequests/42/request-changes"
    );
    expect(methods[0]).toBe("POST");
    expect(out).toEqual({ requested: true });
  });

  it("decline POSTs to /decline and returns id + state", async () => {
    const { ctx, urls, methods } = recordingCtx(() => jsonRes({ ...rawPR, state: "DECLINED" }));
    const out = await declinePR.handler(ctx, { workspace: "acme", repoSlug: "api-server", prId: 42 });
    expect(urls[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/pullrequests/42/decline"
    );
    expect(methods[0]).toBe("POST");
    expect(out).toEqual({ id: 42, state: "DECLINED" });
  });
});

describe("bitbucket_merge_pr", () => {
  it("sends only the provided merge options in the body", async () => {
    const { ctx, urls, methods, bodies } = recordingCtx(() =>
      jsonRes({ ...rawPR, state: "MERGED", merge_commit: { hash: "abcdef123456" } })
    );
    const out = await mergePR.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      prId: 42,
      message: "Merged via agent",
      merge_strategy: "squash",
      close_source_branch: true,
    });

    expect(urls[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/pullrequests/42/merge"
    );
    expect(methods[0]).toBe("POST");
    expect(JSON.parse(bodies[0])).toEqual({
      message: "Merged via agent",
      merge_strategy: "squash",
      close_source_branch: true,
    });
    expect(out).toEqual({ id: 42, state: "MERGED", merge_commit: "abcdef123456" });
  });

  it("sends an empty body when no options given", async () => {
    const { ctx, bodies } = recordingCtx(() => jsonRes({ ...rawPR, state: "MERGED" }));
    await mergePR.handler(ctx, { workspace: "acme", repoSlug: "api-server", prId: 42 });
    expect(JSON.parse(bodies[0])).toEqual({});
  });

  it("warns about irreversibility in the tool description", () => {
    expect(mergePR.description).toMatch(/IRREVERSIBLE/i);
    expect(declinePR.description).toMatch(/closes the PR/i);
  });
});

describe("bitbucket_get_file", () => {
  it("fetches /src/{ref}/{path} and returns raw text", async () => {
    const content = "export const x = 1;\n";
    const { ctx, urls } = recordingCtx(() => textRes(content));
    const out = await getFile.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      ref: "develop",
      path: "src/index.ts",
    });

    expect(urls[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/src/develop/src/index.ts"
    );
    expect(out).toBe(content);
  });

  it("encodes special characters per path segment but keeps slashes", async () => {
    const { ctx, urls } = recordingCtx(() => textRes("ok"));
    await getFile.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      ref: "feat/branch",
      path: "docs/my file.md",
    });
    expect(urls[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/src/feat%2Fbranch/docs/my%20file.md"
    );
  });
});

describe("bitbucket_list_pr_commits", () => {
  it("returns slim rows: 12-char hash, first message line, author fallback", async () => {
    const { ctx, urls } = recordingCtx(() =>
      jsonRes({
        values: [
          {
            hash: "abcdef1234567890abcdef1234567890abcdef12",
            message: "feat: add limiter\n\nLong body with details\nmore lines",
            author: { user: { display_name: "Test User" }, raw: "Test User <dev@example.com>" },
            date: "2026-06-09T10:00:00Z",
            links: {},
            parents: [{ hash: "0000" }],
          },
          {
            hash: "1234567890abcdef1234567890abcdef12345678",
            message: "fix typo",
            author: { raw: "Drive-by <d@x.com>" }, // no user object
            date: "2026-06-09T11:00:00Z",
          },
        ],
      })
    );
    const out = await listPRCommits.handler(ctx, {
      workspace: "acme",
      repoSlug: "api-server",
      prId: 42,
    });

    expect(urls[0]).toBe(
      "https://api.bitbucket.org/2.0/repositories/acme/api-server/pullrequests/42/commits"
    );
    expect(out.commits).toEqual([
      {
        hash: "abcdef123456",
        message: "feat: add limiter",
        author: "Test User",
        date: "2026-06-09T10:00:00Z",
      },
      {
        hash: "1234567890ab",
        message: "fix typo",
        author: "Drive-by <d@x.com>",
        date: "2026-06-09T11:00:00Z",
      },
    ]);
    expect(out.hasMore).toBe(false);
  });
});
