import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/config", () => ({
  config: { JOTS_UPLOAD_TTL_SECONDS: 300 },
}));

import { mint, consume, reapExpired, _setNowForTest, startUploadReaper, stopUploadReaper } from "../../src/jots/pending";

describe("jots/pending", () => {
  let t = 1_000_000;
  beforeEach(() => {
    t = 1_000_000;
    _setNowForTest(() => t);
    reapExpired();
  });

  it("mints a token and consumes it once", () => {
    const { token, expiresAt } = mint({ owner: "u1", name: "site", access: "public" });
    expect(typeof token).toBe("string");
    expect(token.length).toBe(64);
    expect(expiresAt).toBe(t + 300_000);
    const p = consume(token);
    expect(p).toMatchObject({ owner: "u1", name: "site", access: "public" });
    expect(consume(token)).toBeNull();
  });

  it("returns null for an unknown token", () => {
    expect(consume("nope")).toBeNull();
  });

  it("does not return an expired token", () => {
    const { token } = mint({ owner: "u1", name: "site", access: "public" });
    t += 300_001;
    expect(consume(token)).toBeNull();
  });

  it("reapExpired drops only expired entries", () => {
    const a = mint({ owner: "u1", name: "a", access: "public" });
    t += 100_000;
    const b = mint({ owner: "u1", name: "b", access: "public" });
    t += 250_000;
    reapExpired();
    expect(consume(a.token)).toBeNull();
    expect(consume(b.token)).toMatchObject({ name: "b" });
  });

  it("carries the password hash for password jots", () => {
    const { token } = mint({ owner: "u1", name: "s", access: "password", passwordHash: "scrypt$x$y" });
    expect(consume(token)).toMatchObject({ access: "password", passwordHash: "scrypt$x$y" });
  });

  it("the reaper starts idempotently and stops cleanly", () => {
    expect(() => {
      startUploadReaper(60_000);
      startUploadReaper(60_000); // second call is a no-op (timer already set)
      stopUploadReaper();
      stopUploadReaper(); // safe to call when no timer is running
    }).not.toThrow();
  });
});
