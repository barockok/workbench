import { describe, it, expect, vi, afterEach } from "vitest";
import { downloadFile } from "../../plugins/slack/tools/index";

// downloadFile takes a caller-supplied URL and ctx.http attaches the user's
// Slack Bearer token. The OAuth branch of ctx.http has NO host guard (only the
// cookie branch does), so the tool itself must:
//   - reject non-Slack / non-https hosts BEFORE any credentialed request, and
//   - drop the token the moment a redirect leaves a Slack host (presigned CDN).
describe("slack downloadFile (host guard + token scoping)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function bytesRes(body: string, contentType: string) {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": contentType }),
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    } as any;
  }

  it("rejects a non-Slack host without ever calling ctx.http", async () => {
    const http = vi.fn();
    const result = await downloadFile.handler({ http } as any, {
      url: "https://evil.example.com/steal",
    });
    expect(result).toEqual({ ok: false, error: "invalid_host" });
    expect(http).not.toHaveBeenCalled();
  });

  it("rejects a non-https URL", async () => {
    const http = vi.fn();
    const result = await downloadFile.handler({ http } as any, {
      url: "http://files.slack.com/x",
    });
    expect(result).toEqual({ ok: false, error: "invalid_host" });
    expect(http).not.toHaveBeenCalled();
  });

  it("treats an HTML login page as not-authed rather than returning HTML bytes", async () => {
    const http = vi.fn(async () => bytesRes("<html>login</html>", "text/html; charset=utf-8"));
    const result = await downloadFile.handler({ http } as any, {
      url: "https://files.slack.com/files-pri/T1-F1/secret.pdf",
    });
    expect(result).toEqual({ ok: false, error: "not_authed_or_not_found" });
  });

  it("returns base64 bytes on a direct Slack-host hit", async () => {
    const http = vi.fn(async () => bytesRes("PDFDATA", "application/pdf"));
    const result = await downloadFile.handler({ http } as any, {
      url: "https://files.slack.com/files-pri/T1-F1/doc.pdf",
      filename: "doc.pdf",
    });
    expect(result).toEqual({
      ok: true,
      filename: "doc.pdf",
      mimetype: "application/pdf",
      size: Buffer.byteLength("PDFDATA"),
      base64: Buffer.from("PDFDATA").toString("base64"),
    });
  });

  it("follows a redirect to a presigned CDN WITHOUT sending the Bearer token", async () => {
    // ctx.http (credentialed) returns the 302; the off-Slack hop must go via
    // plain global fetch so the token is never sent to the CDN.
    const http = vi.fn(async () => ({
      status: 302,
      headers: new Headers({ location: "https://s3.amazonaws.com/bucket/doc.pdf?sig=abc" }),
    }) as any);
    const fetchMock = vi.fn(async () => bytesRes("CDNBYTES", "application/pdf"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadFile.handler({ http } as any, {
      url: "https://files.slack.com/files-pri/T1-F1/doc.pdf",
    });

    expect(http).toHaveBeenCalledTimes(1); // only the initial Slack hop is credentialed
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://s3.amazonaws.com/bucket/doc.pdf?sig=abc");
    expect(result).toMatchObject({ ok: true, base64: Buffer.from("CDNBYTES").toString("base64") });
  });

  it("rejects a redirect to a non-https location", async () => {
    const http = vi.fn(async () => ({
      status: 302,
      headers: new Headers({ location: "http://evil.example.com/x" }),
    }) as any);
    const result = await downloadFile.handler({ http } as any, {
      url: "https://files.slack.com/files-pri/T1-F1/doc.pdf",
    });
    expect(result).toEqual({ ok: false, error: "invalid_redirect" });
  });
});
