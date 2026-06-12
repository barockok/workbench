import { describe, it, expect, vi } from "vitest";
import { sendEmail, listEmails, getEmail, modifyEmail, listThreads } from "../../plugins/google-gmail/tools/gmail";

// Mock ctx.http that records urls/bodies and replies per-url via a resolver.
function recordingCtx(reply: (url: string, init?: any) => unknown) {
  const urls: string[] = [];
  const bodies: string[] = [];
  const http = vi.fn(async (url: string, init?: any) => {
    urls.push(url);
    if (init?.body) bodies.push(init.body);
    return { status: 200, json: async () => reply(url, init) };
  });
  return { ctx: { http } as any, urls, bodies };
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("google_gmail_list metadata follow-ups", () => {
  it("fetches metadata for each listed id and merges headers into rows", async () => {
    const { ctx, urls } = recordingCtx((url) => {
      if (url.includes("/messages?")) {
        return {
          messages: [
            { id: "m1", threadId: "t1" },
            { id: "m2", threadId: "t2" },
          ],
          nextPageToken: "tok123",
        };
      }
      const id = url.includes("/messages/m1") ? "m1" : "m2";
      return {
        id,
        threadId: id === "m1" ? "t1" : "t2",
        snippet: `snippet-${id}`,
        labelIds: ["INBOX", "UNREAD"],
        payload: {
          headers: [
            { name: "From", value: `${id}-sender@example.com` },
            { name: "Subject", value: `${id} subject` },
            { name: "Date", value: "Fri, 12 Jun 2026 10:00:00 +0000" },
          ],
        },
      };
    });

    const result = await listEmails.handler(ctx, { maxResults: 10, query: "is:unread" });

    // list call carries q + maxResults
    expect(urls[0]).toContain("/messages?");
    expect(urls[0]).toContain("maxResults=10");
    expect(urls[0]).toContain("q=is%3Aunread");

    // one metadata follow-up per id, with the right format/header projection
    const followUps = urls.slice(1);
    expect(followUps).toHaveLength(2);
    for (const u of followUps) {
      expect(u).toContain("format=metadata");
      expect(u).toContain("metadataHeaders=From");
      expect(u).toContain("metadataHeaders=Subject");
      expect(u).toContain("metadataHeaders=Date");
    }

    expect(result.messages).toEqual([
      {
        id: "m1",
        threadId: "t1",
        from: "m1-sender@example.com",
        subject: "m1 subject",
        date: "Fri, 12 Jun 2026 10:00:00 +0000",
        snippet: "snippet-m1",
        labelIds: ["INBOX", "UNREAD"],
      },
      {
        id: "m2",
        threadId: "t2",
        from: "m2-sender@example.com",
        subject: "m2 subject",
        date: "Fri, 12 Jun 2026 10:00:00 +0000",
        snippet: "snippet-m2",
        labelIds: ["INBOX", "UNREAD"],
      },
    ]);
    expect(result.nextPageToken).toBe("tok123");
  });

  it("caps maxResults at 25 to bound the fan-out", async () => {
    const { ctx, urls } = recordingCtx(() => ({ messages: [] }));
    await listEmails.handler(ctx, { maxResults: 100 });
    expect(urls[0]).toContain("maxResults=25");
  });
});

describe("google_gmail_send threading", () => {
  it("puts In-Reply-To/References in the MIME and threadId in the JSON body", async () => {
    const { ctx, bodies } = recordingCtx(() => ({ id: "sent1", threadId: "t9" }));

    await sendEmail.handler(ctx, {
      to: "bob@example.com",
      subject: "Re: hello",
      body: "replying here",
      threadId: "t9",
      inReplyTo: "<orig-msg-id@mail.example.com>",
    });

    const payload = JSON.parse(bodies[0]);
    expect(payload.threadId).toBe("t9");

    const mime = Buffer.from(payload.raw, "base64url").toString("utf8");
    expect(mime).toContain("In-Reply-To: <orig-msg-id@mail.example.com>");
    expect(mime).toContain("References: <orig-msg-id@mail.example.com>");
    expect(mime).toContain("To: bob@example.com");
    expect(mime).toContain("Subject: Re: hello");
    expect(mime).toContain("replying here");
  });

  it("angle-wraps a bare inReplyTo message-id", async () => {
    const { ctx, bodies } = recordingCtx(() => ({}));
    await sendEmail.handler(ctx, {
      to: "bob@example.com",
      subject: "s",
      body: "b",
      threadId: "t1",
      inReplyTo: "bare-id@mail.example.com",
    });
    const mime = Buffer.from(JSON.parse(bodies[0]).raw, "base64url").toString("utf8");
    expect(mime).toContain("In-Reply-To: <bare-id@mail.example.com>");
    expect(mime).toContain("References: <bare-id@mail.example.com>");
  });

  it("omits threading headers and threadId for a fresh send", async () => {
    const { ctx, bodies } = recordingCtx(() => ({}));
    await sendEmail.handler(ctx, { to: "bob@example.com", subject: "s", body: "b" });
    const payload = JSON.parse(bodies[0]);
    expect(payload.threadId).toBeUndefined();
    const mime = Buffer.from(payload.raw, "base64url").toString("utf8");
    expect(mime).not.toContain("In-Reply-To");
    expect(mime).not.toContain("References");
  });
});

describe("google_gmail_modify label mapping", () => {
  it("maps markRead/archive to UNREAD/INBOX removals and merges explicit labels", async () => {
    const { ctx, urls, bodies } = recordingCtx(() => ({
      id: "m1",
      labelIds: ["Label_7"],
    }));

    const result = await modifyEmail.handler(ctx, {
      messageId: "m1",
      addLabelIds: ["Label_7"],
      removeLabelIds: ["Label_3"],
      markRead: true,
      archive: true,
    });

    expect(urls[0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify");
    const body = JSON.parse(bodies[0]);
    expect(body.addLabelIds).toEqual(["Label_7"]);
    expect(body.removeLabelIds).toEqual(["Label_3", "UNREAD", "INBOX"]);
    expect(result).toEqual({ id: "m1", labelIds: ["Label_7"] });
  });

  it("does not duplicate UNREAD when already in removeLabelIds", async () => {
    const { ctx, bodies } = recordingCtx(() => ({ id: "m1", labelIds: [] }));
    await modifyEmail.handler(ctx, { messageId: "m1", removeLabelIds: ["UNREAD"], markRead: true });
    expect(JSON.parse(bodies[0]).removeLabelIds).toEqual(["UNREAD"]);
  });
});

describe("google_gmail_get body decoding", () => {
  const fullMessage = {
    id: "m1",
    threadId: "t1",
    snippet: "snippet text",
    labelIds: ["INBOX"],
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: "alice@example.com" },
        { name: "To", value: "bob@example.com" },
        { name: "Subject", value: "hello" },
        { name: "Date", value: "Fri, 12 Jun 2026 10:00:00 +0000" },
        { name: "Message-ID", value: "<msg-id-1@mail.example.com>" },
      ],
      parts: [
        { mimeType: "text/html", body: { data: b64url("<p>html body</p>") } },
        { mimeType: "text/plain", body: { data: b64url("plain text body\nline two") } },
      ],
    },
  };

  it("decodes the base64url text/plain part and surfaces Message-ID", async () => {
    const { ctx } = recordingCtx(() => fullMessage);
    const result = await getEmail.handler(ctx, { id: "m1", raw: false });
    expect(result).toEqual({
      id: "m1",
      threadId: "t1",
      from: "alice@example.com",
      to: "bob@example.com",
      subject: "hello",
      date: "Fri, 12 Jun 2026 10:00:00 +0000",
      messageIdHeader: "<msg-id-1@mail.example.com>",
      body: "plain text body\nline two",
      labelIds: ["INBOX"],
    });
  });

  it("falls back to snippet when there is no text/plain part", async () => {
    const noPlain = {
      ...fullMessage,
      payload: { ...fullMessage.payload, parts: [{ mimeType: "text/html", body: { data: b64url("<p>x</p>") } }] },
    };
    const { ctx } = recordingCtx(() => noPlain);
    const result = await getEmail.handler(ctx, { id: "m1", raw: false });
    expect(result.body).toBe("snippet text");
  });

  it("returns the unshaped payload when raw=true", async () => {
    const { ctx } = recordingCtx(() => fullMessage);
    const result = await getEmail.handler(ctx, { id: "m1", raw: true });
    expect(result).toEqual(fullMessage);
  });
});

describe("google_gmail_threads shaping", () => {
  it("shapes thread rows to {id, snippet, historyId}", async () => {
    const { ctx } = recordingCtx(() => ({
      threads: [
        { id: "t1", snippet: "s1", historyId: "h1", extra: "junk", messages: [{ huge: "payload" }] },
        { id: "t2", snippet: "s2", historyId: "h2" },
      ],
      nextPageToken: "np",
    }));
    const result = await listThreads.handler(ctx, { maxResults: 10 });
    expect(result.threads).toEqual([
      { id: "t1", snippet: "s1", historyId: "h1" },
      { id: "t2", snippet: "s2", historyId: "h2" },
    ]);
    expect(result.nextPageToken).toBe("np");
  });
});
