import { describe, it, expect, vi } from "vitest";
import { findUsers } from "../../plugins/slack/tools/index";

const MEMBERS = [
  { id: "U1", name: "jdoe", real_name: "John Doe", profile: { email: "jdoe@x.com" } },
  { id: "U2", name: "asmith", real_name: "Alice Smith", profile: { email: "alice@x.com" } },
];

describe("slack findUsers", () => {
  it("email query hits users.lookupByEmail with the email param", async () => {
    const calls: string[] = [];
    const http = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ ok: true, user: MEMBERS[0] }) };
    });
    const result = await findUsers.handler({ http } as any, { query: "jdoe@x.com" });
    expect(calls).toHaveLength(1);
    const parsed = new URL(calls[0]);
    expect(parsed.pathname).toBe("/api/users.lookupByEmail");
    expect(parsed.searchParams.get("email")).toBe("jdoe@x.com");
    expect(parsed.searchParams.get("query")).toBeNull();
    expect(result).toEqual({ ok: true, user: MEMBERS[0] });
  });

  it("name query goes straight to users.list and filters by name/real_name", async () => {
    const calls: string[] = [];
    const http = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ ok: true, members: MEMBERS }) };
    });
    const result = await findUsers.handler({ http } as any, { query: "alice" });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).pathname).toBe("/api/users.list");
    expect(result).toEqual({ ok: true, members: [MEMBERS[1]] });
  });

  it("falls back to users.list when email lookup returns ok:false", async () => {
    const calls: string[] = [];
    const http = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("lookupByEmail")) {
        return { ok: true, json: async () => ({ ok: false, error: "users_not_found" }) };
      }
      return { ok: true, json: async () => ({ ok: true, members: MEMBERS }) };
    });
    const result = await findUsers.handler({ http } as any, { query: "jdoe@x.com" });
    expect(calls).toHaveLength(2);
    expect(result).toEqual({ ok: true, members: [MEMBERS[0]] });
  });

  it("matches email-shaped query against member profile emails in fallback", async () => {
    const http = vi.fn(async (url: string) => {
      if (url.includes("lookupByEmail")) {
        return { ok: true, json: async () => ({ ok: false, error: "users_not_found" }) };
      }
      return { ok: true, json: async () => ({ ok: true, members: MEMBERS }) };
    });
    const result = await findUsers.handler({ http } as any, { query: "ALICE@X.COM" });
    expect(result).toEqual({ ok: true, members: [MEMBERS[1]] });
  });

  it("returns slack error body when users.list fails", async () => {
    const http = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: false, error: "missing_scope" }),
    }));
    const result = await findUsers.handler({ http } as any, { query: "bob" });
    expect(result).toEqual({ ok: false, error: "missing_scope" });
  });
});
