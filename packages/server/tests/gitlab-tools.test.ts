import { describe, it, expect, vi } from "vitest";
import {
  listProjects,
  getProject,
  listBranches,
  listCommits,
  getFile,
  createOrUpdateFile,
  createIssue,
  listIssues,
  updateIssue,
  addIssueComment,
  createMR,
  listMRs,
  getMR,
  getMRDiff,
  addMRComment,
  mergeMR,
  closeMR,
  listPipelines,
  searchCode,
  getCloneUrl,
} from "../../plugins/gitlab/tools/index";

// Recording ctx: captures urls/inits, replies with a canned payload, and lets
// each test pin the connection config (the self-hosted instance origin).
function recordingCtx(
  jsonReply: unknown = {},
  opts: { text?: string; config?: Record<string, unknown>; token?: string; status?: number } = {}
) {
  const urls: string[] = [];
  const inits: any[] = [];
  const http = vi.fn(async (url: string, init?: any) => {
    urls.push(url);
    inits.push(init);
    const res: any = { status: opts.status ?? 200, json: async () => jsonReply };
    if (opts.text !== undefined) res.text = async () => opts.text;
    return res;
  });
  const ctx = {
    http,
    getConfig: () => opts.config ?? {},
    getToken: async () => opts.token ?? "tok",
  } as any;
  return { ctx, urls, inits };
}

describe("gitlab instance base URL", () => {
  it("defaults to gitlab.com when no instance is configured", async () => {
    const { ctx, urls } = recordingCtx([]);
    await listProjects.handler(ctx, {});
    expect(urls[0]).toMatch(/^https:\/\/gitlab\.com\/api\/v4\/projects\?/);
  });

  it("uses the self-hosted origin from getConfig", async () => {
    const { ctx, urls } = recordingCtx([], { config: { instanceUrl: "https://gitlab.acme.com" } });
    await listProjects.handler(ctx, {});
    expect(urls[0]).toMatch(/^https:\/\/gitlab\.acme\.com\/api\/v4\/projects\?/);
  });
});

describe("project identifier encoding", () => {
  it("URL-encodes a namespace/path project id", async () => {
    const { ctx, urls } = recordingCtx({});
    await getProject.handler(ctx, { project: "group/sub/repo" });
    expect(urls[0]).toBe("https://gitlab.com/api/v4/projects/group%2Fsub%2Frepo");
  });

  it("passes a numeric id through encoded (no slashes)", async () => {
    const { ctx, urls } = recordingCtx([]);
    await listBranches.handler(ctx, { project: "42" });
    expect(urls[0]).toMatch(/\/projects\/42\/repository\/branches/);
  });
});

describe("gitlab_list_projects", () => {
  it("slims rows and sets membership", async () => {
    const { ctx, urls } = recordingCtx([
      { id: 1, path_with_namespace: "g/r", visibility: "private", default_branch: "main", description: "x", extra: "drop" },
    ]);
    const out = await listProjects.handler(ctx, {});
    expect(urls[0]).toContain("membership=true");
    expect(out).toEqual([
      { id: 1, path_with_namespace: "g/r", visibility: "private", default_branch: "main", last_activity_at: undefined, description: "x" },
    ]);
    expect(out[0]).not.toHaveProperty("extra");
  });
});

describe("gitlab_list_commits", () => {
  it("truncates sha to 12 chars and maps fields", async () => {
    const { ctx, urls } = recordingCtx([
      { id: "abcdef0123456789", title: "msg", author_name: "Ada", committed_date: "2026-01-01" },
    ]);
    const out = await listCommits.handler(ctx, { project: "g/r", ref: "dev" });
    expect(urls[0]).toContain("ref_name=dev");
    expect(out[0]).toEqual({ id: "abcdef012345", title: "msg", author: "Ada", date: "2026-01-01" });
  });
});

describe("gitlab_get_file", () => {
  it("encodes the file path and hits the raw endpoint", async () => {
    const { ctx, urls } = recordingCtx({}, { text: "file body" });
    const out = await getFile.handler(ctx, { project: "g/r", path: "src/a b.ts", ref: "main" });
    expect(urls[0]).toBe(
      "https://gitlab.com/api/v4/projects/g%2Fr/repository/files/src%2Fa%20b.ts/raw?ref=main"
    );
    expect(out).toBe("file body");
  });
});

describe("gitlab_create_or_update_file", () => {
  it("uses PUT when the file already exists", async () => {
    const { ctx, inits } = recordingCtx({ file_path: "a.ts", branch: "main" }, { status: 200 });
    const out = await createOrUpdateFile.handler(ctx, {
      project: "g/r",
      path: "a.ts",
      content: "x",
      message: "m",
      branch: "main",
    });
    // inits[0] = existence probe (GET, no method), inits[1] = the write
    expect(inits[1].method).toBe("PUT");
    expect(out.action).toBe("updated");
  });

  it("uses POST when the file does not exist", async () => {
    const { ctx, inits } = recordingCtx({ file_path: "a.ts", branch: "main" }, { status: 404 });
    const out = await createOrUpdateFile.handler(ctx, {
      project: "g/r",
      path: "a.ts",
      content: "x",
      message: "m",
    });
    expect(inits[1].method).toBe("POST");
    expect(out.action).toBe("created");
  });
});

describe("gitlab_create_issue", () => {
  it("joins labels into a comma string", async () => {
    const { ctx, inits } = recordingCtx({ iid: 5, title: "t", state: "opened" });
    await createIssue.handler(ctx, { project: "g/r", title: "t", labels: ["bug", "p1"] });
    expect(JSON.parse(inits[0].body).labels).toBe("bug,p1");
  });
});

describe("gitlab_list_issues", () => {
  it("omits the state param when state=all", async () => {
    const { ctx, urls } = recordingCtx([]);
    await listIssues.handler(ctx, { project: "g/r", state: "all" });
    expect(urls[0]).not.toContain("state=");
  });
});

describe("gitlab_update_issue", () => {
  it("maps closed → state_event close", async () => {
    const { ctx, inits } = recordingCtx({ iid: 1, state: "closed" });
    await updateIssue.handler(ctx, { project: "g/r", issueIid: 1, state: "closed" });
    expect(JSON.parse(inits[0].body).state_event).toBe("close");
  });
  it("maps opened → state_event reopen", async () => {
    const { ctx, inits } = recordingCtx({ iid: 1, state: "opened" });
    await updateIssue.handler(ctx, { project: "g/r", issueIid: 1, state: "opened" });
    expect(JSON.parse(inits[0].body).state_event).toBe("reopen");
  });
});

describe("gitlab_add_issue_comment", () => {
  it("posts to the notes endpoint", async () => {
    const { ctx, urls } = recordingCtx({ id: 9, created_at: "t" });
    await addIssueComment.handler(ctx, { project: "g/r", issueIid: 3, body: "hi" });
    expect(urls[0]).toBe("https://gitlab.com/api/v4/projects/g%2Fr/issues/3/notes");
  });
});

describe("gitlab_create_mr", () => {
  it("maps branch fields to GitLab names", async () => {
    const { ctx, inits } = recordingCtx({ iid: 2, state: "opened" });
    await createMR.handler(ctx, { project: "g/r", title: "t", sourceBranch: "feat", targetBranch: "main" });
    const body = JSON.parse(inits[0].body);
    expect(body.source_branch).toBe("feat");
    expect(body.target_branch).toBe("main");
  });
});

describe("gitlab_get_mr_diff", () => {
  it("diffstat=true returns per-file rows without the patch text", async () => {
    const { ctx } = recordingCtx({
      changes: [{ old_path: "a", new_path: "a", new_file: false, deleted_file: false, renamed_file: false, diff: "@@ huge @@" }],
    });
    const out = await getMRDiff.handler(ctx, { project: "g/r", mrIid: 1, diffstat: true });
    expect(out.files[0]).toEqual({ old_path: "a", new_path: "a", new_file: false, deleted_file: false, renamed_file: false });
  });

  it("diffstat=false concatenates unified diff text", async () => {
    const { ctx } = recordingCtx({ changes: [{ old_path: "a", new_path: "a", diff: "+line\n" }] });
    const out = await getMRDiff.handler(ctx, { project: "g/r", mrIid: 1, diffstat: false });
    expect(out).toContain("diff --git a/a b/a");
    expect(out).toContain("+line");
  });
});

describe("gitlab_add_mr_comment", () => {
  it("posts a plain note when no inline anchor", async () => {
    const { ctx, urls } = recordingCtx({ id: 1, created_at: "t" });
    await addMRComment.handler(ctx, { project: "g/r", mrIid: 4, body: "lgtm" });
    expect(urls[0]).toBe("https://gitlab.com/api/v4/projects/g%2Fr/merge_requests/4/notes");
  });

  it("resolves diff_refs and posts a discussion for an inline comment", async () => {
    const { ctx, urls, inits } = recordingCtx({
      diff_refs: { base_sha: "b", head_sha: "h", start_sha: "s" },
      id: 1,
    });
    await addMRComment.handler(ctx, {
      project: "g/r",
      mrIid: 4,
      body: "nit",
      inline: { path: "a.ts", line: 10 },
    });
    // urls[0] = GET MR (for diff_refs), urls[1] = POST discussion
    expect(urls[1]).toBe("https://gitlab.com/api/v4/projects/g%2Fr/merge_requests/4/discussions");
    const pos = JSON.parse(inits[1].body).position;
    expect(pos).toMatchObject({ base_sha: "b", head_sha: "h", start_sha: "s", new_path: "a.ts", new_line: 10 });
  });
});

describe("gitlab_merge_mr", () => {
  it("maps remove_source_branch to should_remove_source_branch", async () => {
    const { ctx, inits } = recordingCtx({ iid: 1, state: "merged" });
    await mergeMR.handler(ctx, { project: "g/r", mrIid: 1, remove_source_branch: true, squash: true });
    const body = JSON.parse(inits[0].body);
    expect(body.should_remove_source_branch).toBe(true);
    expect(body.squash).toBe(true);
    expect(inits[0].method).toBe("PUT");
  });
});

describe("gitlab_close_mr", () => {
  it("PUTs state_event close", async () => {
    const { ctx, inits } = recordingCtx({ iid: 1, state: "closed" });
    await closeMR.handler(ctx, { project: "g/r", mrIid: 1 });
    expect(JSON.parse(inits[0].body).state_event).toBe("close");
  });
});

describe("gitlab_list_pipelines", () => {
  it("slims rows and forwards filters", async () => {
    const { ctx, urls } = recordingCtx([
      { id: 7, status: "failed", ref: "main", sha: "abcdef0123456789", source: "push", web_url: "u" },
    ]);
    const out = await listPipelines.handler(ctx, { project: "g/r", status: "failed", ref: "main" });
    expect(urls[0]).toContain("status=failed");
    expect(out[0]).toMatchObject({ id: 7, status: "failed", sha: "abcdef012345" });
  });
});

describe("gitlab_search_code", () => {
  it("scopes to a project when project is given", async () => {
    const { ctx, urls } = recordingCtx([]);
    await searchCode.handler(ctx, { q: "TODO", project: "g/r" });
    expect(urls[0]).toContain("/projects/g%2Fr/search?");
    expect(urls[0]).toContain("scope=blobs");
  });

  it("uses global search without a project", async () => {
    const { ctx, urls } = recordingCtx([]);
    await searchCode.handler(ctx, { q: "TODO" });
    expect(urls[0]).toMatch(/\/api\/v4\/search\?/);
  });
});

describe("gitlab_get_clone_url", () => {
  it("embeds the oauth2 token and the instance host", async () => {
    const { ctx } = recordingCtx({}, { config: { instanceUrl: "https://gitlab.acme.com" }, token: "secret" });
    const out = await getCloneUrl.handler(ctx, { project: "group/repo" });
    expect(out.cloneUrl).toBe("https://oauth2:secret@gitlab.acme.com/group/repo.git");
  });

  it("strips a trailing .git and slashes from the project path", async () => {
    const { ctx } = recordingCtx({}, { token: "t" });
    const out = await getCloneUrl.handler(ctx, { project: "/group/repo.git" });
    expect(out.cloneUrl).toBe("https://oauth2:t@gitlab.com/group/repo.git");
  });
});
