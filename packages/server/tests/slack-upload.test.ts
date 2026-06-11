import { describe, it, expect, vi } from "vitest";
import { uploadFile } from "../../plugins/slack/tools/index";

// Slack killed files.upload for new apps (method_deprecated). The tool must
// use the 3-step external upload flow:
//   1. files.getUploadURLExternal (filename + byte length) → upload_url + file_id
//   2. POST raw bytes to upload_url
//   3. files.completeUploadExternal (file_id + channel_id) → shares the file
describe("slack uploadFile (external upload flow)", () => {
  function mockCtx() {
    const calls: Array<{ url: string; init?: any }> = [];
    const http = vi.fn(async (url: string, init?: any) => {
      calls.push({ url, init });
      if (url.includes("files.getUploadURLExternal")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            upload_url: "https://files.slack.com/upload/v1/abc123",
            file_id: "F123",
          }),
        };
      }
      if (url.startsWith("https://files.slack.com/upload/")) {
        return { ok: true, text: async () => "OK", json: async () => ({}) };
      }
      if (url.includes("files.completeUploadExternal")) {
        return {
          ok: true,
          json: async () => ({ ok: true, files: [{ id: "F123", title: "report" }] }),
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    return { ctx: { http } as any, calls };
  }

  it("runs the 3-step flow in order and returns the complete response", async () => {
    const { ctx, calls } = mockCtx();
    const result = await uploadFile.handler(ctx, {
      channel: "C999",
      content: "hello world",
      filename: "report.txt",
      title: "report",
    });

    expect(calls).toHaveLength(3);

    // 1. get upload URL with filename and exact byte length
    const getUrl = new URL(calls[0].url);
    expect(getUrl.pathname).toBe("/api/files.getUploadURLExternal");
    expect(getUrl.searchParams.get("filename")).toBe("report.txt");
    expect(getUrl.searchParams.get("length")).toBe(String(Buffer.byteLength("hello world")));

    // 2. raw bytes POSTed to the returned upload_url
    expect(calls[1].url).toBe("https://files.slack.com/upload/v1/abc123");
    expect(calls[1].init.method).toBe("POST");
    expect(Buffer.from(calls[1].init.body).toString()).toBe("hello world");

    // 3. complete + share to channel
    expect(calls[2].url).toBe("https://slack.com/api/files.completeUploadExternal");
    const body = JSON.parse(calls[2].init.body);
    expect(body.channel_id).toBe("C999");
    expect(body.files).toEqual([{ id: "F123", title: "report" }]);

    expect(result).toEqual({ ok: true, files: [{ id: "F123", title: "report" }] });
  });

  it("uses utf-8 byte length, not string length", async () => {
    const { ctx, calls } = mockCtx();
    await uploadFile.handler(ctx, {
      channel: "C999",
      content: "héllo", // 5 chars, 6 bytes
      filename: "f.txt",
    });
    const getUrl = new URL(calls[0].url);
    expect(getUrl.searchParams.get("length")).toBe("6");
  });

  it("defaults title to filename", async () => {
    const { ctx, calls } = mockCtx();
    await uploadFile.handler(ctx, {
      channel: "C999",
      content: "x",
      filename: "notes.md",
    });
    const body = JSON.parse(calls[2].init.body);
    expect(body.files).toEqual([{ id: "F123", title: "notes.md" }]);
  });

  it("returns the slack error without uploading when getUploadURLExternal fails", async () => {
    const calls: string[] = [];
    const http = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ ok: false, error: "invalid_auth" }) };
    });
    const result = await uploadFile.handler({ http } as any, {
      channel: "C999",
      content: "x",
      filename: "f.txt",
    });
    expect(result).toEqual({ ok: false, error: "invalid_auth" });
    expect(calls).toHaveLength(1);
  });

  it("throws when the byte upload itself fails", async () => {
    const http = vi.fn(async (url: string) => {
      if (url.includes("getUploadURLExternal")) {
        return {
          ok: true,
          json: async () => ({ ok: true, upload_url: "https://files.slack.com/upload/v1/x", file_id: "F1" }),
        };
      }
      return { ok: false, status: 500, text: async () => "server error" };
    });
    await expect(
      uploadFile.handler({ http } as any, { channel: "C1", content: "x", filename: "f" })
    ).rejects.toThrow(/upload failed/i);
  });
});
