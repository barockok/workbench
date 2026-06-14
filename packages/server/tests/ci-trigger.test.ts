import { describe, it, expect, vi } from "vitest";
import { triggerWorkflow, rerunWorkflowRun, cancelWorkflowRun } from "../../plugins/github/tools/index";
import { triggerPipeline } from "../../plugins/gitlab/tools/index";
import { triggerPipeline as bbTrigger, stopPipeline as bbStop } from "../../plugins/atlassian-bitbucket/tools/index";

describe("github CI triggers", () => {
  it("workflow_dispatch POSTs ref + inputs and treats 204 as ok", async () => {
    const calls: any[] = [];
    const http = vi.fn(async (url: string, init?: any) => {
      calls.push({ url, init });
      return { status: 204 } as any;
    });
    const result = await triggerWorkflow.handler({ http } as any, {
      owner: "o", repo: "r", workflow: "ci.yml", ref: "main", inputs: { env: "prod" },
    });
    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/actions/workflows/ci.yml/dispatches");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({ ref: "main", inputs: { env: "prod" } });
  });

  it("workflow_dispatch surfaces the github error body on non-204", async () => {
    const http = vi.fn(async () => ({ status: 422, json: async () => ({ message: "no workflow_dispatch" }) }) as any);
    const result = await triggerWorkflow.handler({ http } as any, { owner: "o", repo: "r", workflow: "ci.yml", ref: "main" });
    expect(result).toEqual({ ok: false, status: 422, error: { message: "no workflow_dispatch" } });
  });

  it("rerun uses rerun-failed-jobs only when failedOnly is set; 201 = ok", async () => {
    const calls: string[] = [];
    const http = vi.fn(async (url: string) => { calls.push(url); return { status: 201 } as any; });
    await rerunWorkflowRun.handler({ http } as any, { owner: "o", repo: "r", runId: 5, failedOnly: true });
    await rerunWorkflowRun.handler({ http } as any, { owner: "o", repo: "r", runId: 5, failedOnly: false });
    expect(calls[0]).toBe("https://api.github.com/repos/o/r/actions/runs/5/rerun-failed-jobs");
    expect(calls[1]).toBe("https://api.github.com/repos/o/r/actions/runs/5/rerun");
  });

  it("cancel treats 202 as ok", async () => {
    const http = vi.fn(async () => ({ status: 202 }) as any);
    expect(await cancelWorkflowRun.handler({ http } as any, { owner: "o", repo: "r", runId: 5 })).toEqual({ ok: true });
  });
});

describe("gitlab pipeline trigger", () => {
  it("POSTs ref + maps variables to {key,value}[] and slims the response", async () => {
    const calls: any[] = [];
    const http = vi.fn(async (url: string, init?: any) => {
      calls.push({ url, init });
      return { json: async () => ({ id: 99, status: "pending", ref: "main", sha: "abcdef1234567890", source: "api", web_url: "u", created_at: "t", updated_at: "t" }) } as any;
    });
    const ctx = { http, getConfig: () => ({ instanceUrl: "https://gitlab.com" }) } as any;
    const result = await triggerPipeline.handler(ctx, { project: "g/p", ref: "main", variables: { K: "V" } });
    expect(calls[0].url).toBe("https://gitlab.com/api/v4/projects/g%2Fp/pipeline");
    expect(JSON.parse(calls[0].init.body)).toEqual({ ref: "main", variables: [{ key: "K", value: "V" }] });
    expect(result).toMatchObject({ id: 99, status: "pending", sha: "abcdef123456" });
  });
});

describe("bitbucket pipeline trigger", () => {
  function ctxWith(http: any) {
    return { http } as any;
  }
  it("POSTs a pipeline_ref_target and adds a custom selector when given", async () => {
    const calls: any[] = [];
    const http = vi.fn(async (url: string, init?: any) => {
      calls.push({ url, init });
      if (url.includes("/pipelines/")) return { json: async () => ({ uuid: "{x}", build_number: 1, state: { name: "PENDING" }, target: { ref_name: "main" } }) } as any;
      throw new Error(`unexpected ${url}`);
    });
    const result = await bbTrigger.handler(ctxWith(http), { workspace: "ws", repoSlug: "r", ref: "main", custom: "deploy" });
    expect(calls[0].url).toBe("https://api.bitbucket.org/2.0/repositories/ws/r/pipelines/");
    const body = JSON.parse(calls[0].init.body);
    expect(body.target).toEqual({ ref_type: "branch", type: "pipeline_ref_target", ref_name: "main", selector: { type: "custom", pattern: "deploy" } });
    expect(result).toMatchObject({ uuid: "{x}", state: "PENDING", ref_name: "main" });
  });

  it("stop treats 204 as ok", async () => {
    const http = vi.fn(async () => ({ status: 204 }) as any);
    expect(await bbStop.handler(ctxWith(http), { workspace: "ws", repoSlug: "r", pipelineUuid: "{x}" })).toEqual({ ok: true });
  });
});
