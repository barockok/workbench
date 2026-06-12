import { describe, it, expect, vi } from "vitest";
import {
  listRepos,
  listCommits,
  listBranches,
  listReleases,
  listPRs,
  getPR,
  getPRDiff,
  listPRComments,
  addPRComment,
  mergePR,
  createPRReview,
  listIssues,
  getIssue,
  updateIssue,
  addIssueComment,
  searchCode,
  searchIssues,
  listWorkflowRuns,
} from "../../plugins/github/tools/index";

// Mock ctx.http that records urls / inits and replies with a canned payload.
function recordingCtx(jsonReply: unknown = {}, opts: { text?: string } = {}) {
  const urls: string[] = [];
  const inits: any[] = [];
  const http = vi.fn(async (url: string, init?: any) => {
    urls.push(url);
    inits.push(init);
    const res: any = { status: 200, json: async () => jsonReply };
    if (opts.text !== undefined) res.text = async () => opts.text;
    return res;
  });
  return { ctx: { http } as any, urls, inits };
}

describe("github_get_pr_diff", () => {
  it("sends the v3.diff Accept header and returns raw diff text", async () => {
    const { ctx, urls, inits } = recordingCtx({}, { text: "diff --git a/x b/x" });
    const out = await getPRDiff.handler(ctx, { owner: "o", repo: "r", prNumber: 7, files: false });
    expect(urls[0]).toBe("https://api.github.com/repos/o/r/pulls/7");
    expect(inits[0].headers.Accept).toBe("application/vnd.github.v3.diff");
    expect(out).toBe("diff --git a/x b/x");
  });

  it("files:true hits /files and returns slim rows without patch", async () => {
    const { ctx, urls } = recordingCtx([
      { filename: "a.ts", status: "modified", additions: 3, deletions: 1, patch: "@@ huge @@" },
    ]);
    const out = await getPRDiff.handler(ctx, { owner: "o", repo: "r", prNumber: 7, files: true });
    expect(urls[0]).toBe("https://api.github.com/repos/o/r/pulls/7/files");
    expect(out).toEqual([{ filename: "a.ts", status: "modified", additions: 3, deletions: 1 }]);
    expect(out[0]).not.toHaveProperty("patch");
  });
});

describe("github_add_pr_comment", () => {
  it("rejects type=review without commit_id/path/line", async () => {
    const { ctx } = recordingCtx();
    await expect(
      addPRComment.handler(ctx, { owner: "o", repo: "r", prNumber: 1, body: "hi", type: "review" }),
    ).rejects.toThrow(/commit_id, path, and line/);
    expect(ctx.http).not.toHaveBeenCalled();
  });

  it("type=review posts to /pulls/{n}/comments with anchor fields", async () => {
    const { ctx, urls, inits } = recordingCtx({ id: 9, html_url: "u" });
    const out = await addPRComment.handler(ctx, {
      owner: "o",
      repo: "r",
      prNumber: 1,
      body: "nit",
      type: "review",
      commit_id: "abc123",
      path: "src/a.ts",
      line: 42,
    });
    expect(urls[0]).toBe("https://api.github.com/repos/o/r/pulls/1/comments");
    expect(JSON.parse(inits[0].body)).toEqual({ body: "nit", commit_id: "abc123", path: "src/a.ts", line: 42 });
    expect(out).toEqual({ id: 9, html_url: "u" });
  });

  it("type=discussion posts to /issues/{n}/comments with body only", async () => {
    const { ctx, urls, inits } = recordingCtx({ id: 2, html_url: "u2" });
    await addPRComment.handler(ctx, { owner: "o", repo: "r", prNumber: 1, body: "hello", type: "discussion" });
    expect(urls[0]).toBe("https://api.github.com/repos/o/r/issues/1/comments");
    expect(JSON.parse(inits[0].body)).toEqual({ body: "hello" });
  });
});

describe("github_list_pr_comments", () => {
  it("type=review reads /pulls/{n}/comments, discussion reads /issues/{n}/comments", async () => {
    const { ctx, urls } = recordingCtx([]);
    await listPRComments.handler(ctx, { owner: "o", repo: "r", prNumber: 3, type: "review" });
    await listPRComments.handler(ctx, { owner: "o", repo: "r", prNumber: 3, type: "discussion" });
    expect(urls[0]).toBe("https://api.github.com/repos/o/r/pulls/3/comments");
    expect(urls[1]).toBe("https://api.github.com/repos/o/r/issues/3/comments");
  });

  it("slims rows to id/author/body/path/line/created_at", async () => {
    const { ctx } = recordingCtx([
      { id: 1, user: { login: "ada", id: 999 }, body: "b", path: "f.ts", line: 5, created_at: "t", url: "junk" },
    ]);
    const out = await listPRComments.handler(ctx, { owner: "o", repo: "r", prNumber: 3, type: "review" });
    expect(out).toEqual([{ id: 1, author: "ada", body: "b", path: "f.ts", line: 5, created_at: "t" }]);
  });
});

describe("github_merge_pr", () => {
  it("PUTs to /merge with merge_method and commit_title in the body", async () => {
    const { ctx, urls, inits } = recordingCtx({ merged: true, sha: "s", message: "ok" });
    const out = await mergePR.handler(ctx, {
      owner: "o",
      repo: "r",
      prNumber: 5,
      merge_method: "squash",
      commit_title: "feat: x",
    });
    expect(urls[0]).toBe("https://api.github.com/repos/o/r/pulls/5/merge");
    expect(inits[0].method).toBe("PUT");
    expect(JSON.parse(inits[0].body)).toEqual({ merge_method: "squash", commit_title: "feat: x" });
    expect(out).toEqual({ merged: true, sha: "s", message: "ok" });
  });

  it("sends an empty body when no options given", async () => {
    const { ctx, inits } = recordingCtx({ merged: true });
    await mergePR.handler(ctx, { owner: "o", repo: "r", prNumber: 5 });
    expect(JSON.parse(inits[0].body)).toEqual({});
  });
});

describe("github_create_pr_review", () => {
  it("POSTs event (+optional body) and returns { id, state }", async () => {
    const { ctx, urls, inits } = recordingCtx({ id: 11, state: "APPROVED", user: { login: "x" } });
    const out = await createPRReview.handler(ctx, {
      owner: "o",
      repo: "r",
      prNumber: 5,
      event: "APPROVE",
      body: "lgtm",
    });
    expect(urls[0]).toBe("https://api.github.com/repos/o/r/pulls/5/reviews");
    expect(JSON.parse(inits[0].body)).toEqual({ event: "APPROVE", body: "lgtm" });
    expect(out).toEqual({ id: 11, state: "APPROVED" });
  });
});

describe("github_update_issue", () => {
  it("PATCHes only the provided fields", async () => {
    const { ctx, urls, inits } = recordingCtx({ number: 8, title: "t", state: "closed", html_url: "u" });
    await updateIssue.handler(ctx, { owner: "o", repo: "r", issueNumber: 8, state: "closed" });
    expect(urls[0]).toBe("https://api.github.com/repos/o/r/issues/8");
    expect(inits[0].method).toBe("PATCH");
    expect(JSON.parse(inits[0].body)).toEqual({ state: "closed" });
  });

  it("includes labels/assignees arrays when passed", async () => {
    const { ctx, inits } = recordingCtx({});
    await updateIssue.handler(ctx, {
      owner: "o",
      repo: "r",
      issueNumber: 8,
      labels: ["bug"],
      assignees: ["ada"],
    });
    expect(JSON.parse(inits[0].body)).toEqual({ labels: ["bug"], assignees: ["ada"] });
  });
});

describe("github_add_issue_comment", () => {
  it("POSTs the body and returns { id, html_url }", async () => {
    const { ctx, urls, inits } = recordingCtx({ id: 3, html_url: "u", user: { login: "x" } });
    const out = await addIssueComment.handler(ctx, { owner: "o", repo: "r", issueNumber: 4, body: "done" });
    expect(urls[0]).toBe("https://api.github.com/repos/o/r/issues/4/comments");
    expect(JSON.parse(inits[0].body)).toEqual({ body: "done" });
    expect(out).toEqual({ id: 3, html_url: "u" });
  });
});

describe("search tools pass qualifiers through verbatim", () => {
  it("github_search_code forwards repo: qualifier in q", async () => {
    const { ctx, urls } = recordingCtx({ items: [] });
    await searchCode.handler(ctx, { q: "repo:owner/name TODO language:ts", perPage: 10, page: 1 });
    const u = new URL(urls[0]);
    expect(u.pathname).toBe("/search/code");
    expect(u.searchParams.get("q")).toBe("repo:owner/name TODO language:ts");
    expect(u.searchParams.get("per_page")).toBe("10");
  });

  it("github_search_issues forwards qualifiers and derives repository from repository_url", async () => {
    const { ctx, urls } = recordingCtx({
      items: [
        {
          number: 1,
          title: "t",
          state: "open",
          user: { login: "ada" },
          labels: [{ name: "bug" }],
          comments: 2,
          updated_at: "now",
          pull_request: {},
          repository_url: "https://api.github.com/repos/owner/name",
        },
      ],
    });
    const out = await searchIssues.handler(ctx, { q: "repo:owner/name is:open label:bug", perPage: 10, page: 1 });
    expect(new URL(urls[0]).searchParams.get("q")).toBe("repo:owner/name is:open label:bug");
    expect(out[0]).toEqual({
      number: 1,
      title: "t",
      state: "open",
      author: "ada",
      labels: ["bug"],
      comments: 2,
      updated_at: "now",
      is_pr: true,
      repository: "owner/name",
    });
  });
});

describe("slim shapes on list tools", () => {
  it("github_list_prs returns slim PR rows", async () => {
    const { ctx, urls } = recordingCtx([
      {
        number: 12,
        title: "T",
        state: "open",
        user: { login: "ada" },
        head: { ref: "feat", sha: "x", repo: { huge: true } },
        base: { ref: "main" },
        draft: false,
        updated_at: "now",
        _links: {},
      },
    ]);
    const out = await listPRs.handler(ctx, { owner: "o", repo: "r", state: "open", perPage: 10, page: 1 });
    const u = new URL(urls[0]);
    expect(u.pathname).toBe("/repos/o/r/pulls");
    expect(u.searchParams.get("state")).toBe("open");
    expect(out).toEqual([
      { number: 12, title: "T", state: "open", author: "ada", head: "feat", base: "main", draft: false, updated_at: "now" },
    ]);
  });

  it("github_get_pr truncates the body to 2000 chars", async () => {
    const long = "x".repeat(5000);
    const { ctx } = recordingCtx({ number: 1, body: long, user: { login: "a" }, head: {}, base: {} });
    const out = await getPR.handler(ctx, { owner: "o", repo: "r", prNumber: 1 });
    expect(out.body.length).toBeLessThanOrEqual(2001); // 2000 + ellipsis
    expect(out.body.startsWith("xxx")).toBe(true);
  });

  it("github_list_issues slims rows and flags PRs", async () => {
    const { ctx, urls } = recordingCtx([
      {
        number: 2,
        title: "i",
        state: "open",
        user: { login: "bob" },
        labels: [{ name: "p1" }, "raw"],
        assignee: { login: "ada" },
        comments: 0,
        updated_at: "now",
        pull_request: { url: "x" },
        body: "should not appear",
      },
    ]);
    const out = await listIssues.handler(ctx, { owner: "o", repo: "r", state: "open", perPage: 10, page: 1 });
    expect(new URL(urls[0]).searchParams.get("state")).toBe("open");
    expect(out).toEqual([
      {
        number: 2,
        title: "i",
        state: "open",
        author: "bob",
        labels: ["p1", "raw"],
        assignee: "ada",
        comments: 0,
        updated_at: "now",
        is_pr: true,
      },
    ]);
  });

  it("github_get_issue returns slim issue with truncated body", async () => {
    const { ctx } = recordingCtx({
      number: 3,
      title: "t",
      body: "b".repeat(3000),
      state: "open",
      user: { login: "ada" },
      labels: [{ name: "bug" }],
      assignees: [{ login: "bob" }],
      comments: 1,
      html_url: "u",
    });
    const out = await getIssue.handler(ctx, { owner: "o", repo: "r", issueNumber: 3 });
    expect(out.labels).toEqual(["bug"]);
    expect(out.assignees).toEqual(["bob"]);
    expect(out.body.length).toBeLessThanOrEqual(2001);
  });

  it("github_list_repos returns slim repo rows", async () => {
    const { ctx } = recordingCtx([
      {
        full_name: "o/r",
        private: false,
        default_branch: "main",
        updated_at: "now",
        description: "d",
        language: "TypeScript",
        owner: { login: "o", avatar_url: "..." },
        forks_url: "junk",
      },
    ]);
    const out = await listRepos.handler(ctx, { type: "all", perPage: 30, page: 1 });
    expect(out).toEqual([
      { full_name: "o/r", private: false, default_branch: "main", updated_at: "now", description: "d", language: "TypeScript" },
    ]);
  });

  it("github_list_commits slims to 12-char sha + first message line", async () => {
    const { ctx } = recordingCtx([
      {
        sha: "abcdef0123456789abcdef0123456789abcdef01",
        commit: { message: "feat: thing\n\nlong body here", author: { name: "Ada", date: "2026-01-01" } },
        author: { login: "ada" },
      },
    ]);
    const out = await listCommits.handler(ctx, { owner: "o", repo: "r", perPage: 30, page: 1 });
    expect(out).toEqual([{ sha: "abcdef012345", message: "feat: thing", author: "Ada", date: "2026-01-01" }]);
  });

  it("github_list_branches and github_list_releases return slim rows", async () => {
    const b = recordingCtx([{ name: "main", protected: true, commit: { sha: "x", url: "y" } }]);
    const branches = await listBranches.handler(b.ctx, { owner: "o", repo: "r", perPage: 30, page: 1 });
    expect(branches).toEqual([{ name: "main", protected: true }]);

    const r = recordingCtx([
      { tag_name: "v1.0.0", name: "v1", draft: false, prerelease: false, published_at: "now", assets: [{ big: 1 }] },
    ]);
    const releases = await listReleases.handler(r.ctx, { owner: "o", repo: "r", perPage: 30, page: 1 });
    expect(releases).toEqual([{ tag_name: "v1.0.0", name: "v1", draft: false, prerelease: false, published_at: "now" }]);
  });

  it("github_list_workflow_runs slims workflow_runs and applies filters", async () => {
    const { ctx, urls } = recordingCtx({
      workflow_runs: [
        {
          id: 1,
          name: "CI",
          head_branch: "main",
          event: "push",
          status: "completed",
          conclusion: "success",
          run_started_at: "now",
          html_url: "u",
          repository: { huge: true },
        },
      ],
    });
    const out = await listWorkflowRuns.handler(ctx, {
      owner: "o",
      repo: "r",
      branch: "main",
      status: "completed",
      perPage: 10,
      page: 1,
    });
    const u = new URL(urls[0]);
    expect(u.pathname).toBe("/repos/o/r/actions/runs");
    expect(u.searchParams.get("branch")).toBe("main");
    expect(u.searchParams.get("status")).toBe("completed");
    expect(out).toEqual([
      {
        id: 1,
        name: "CI",
        head_branch: "main",
        event: "push",
        status: "completed",
        conclusion: "success",
        run_started_at: "now",
        html_url: "u",
      },
    ]);
  });
});
