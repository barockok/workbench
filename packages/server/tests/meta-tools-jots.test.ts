import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/jots/store", () => ({
  deployJot: vi.fn(),
  listJots: vi.fn(),
  deleteJot: vi.fn(),
  readManifest: vi.fn(() => null),
}));
vi.mock("../src/jots/pending", () => ({
  mint: vi.fn(() => ({ token: "tok123", expiresAt: 42 })),
}));
vi.mock("../src/jots/auth", () => ({
  hashPassword: vi.fn(() => "scrypt$salt$hash"),
}));

import { metaTools } from "../src/mcp/meta-tools";
import * as store from "../src/jots/store";
import { hashPassword } from "../src/jots/auth";
import { mint } from "../src/jots/pending";
import { readManifest } from "../src/jots/store";

function findTool(name: string) {
  return metaTools.find((t) => t.name === name)!;
}

describe("meta-tools jots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deploy_jot mints a token and returns the upload URL for a public jot", async () => {
    vi.mocked(readManifest).mockReturnValue(null);
    const tool = findTool("deploy_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "r", access: "public" });
    expect(mint).toHaveBeenCalledWith({ owner: "u1", name: "r", access: "public", passwordHash: undefined });
    expect(result).toMatchObject({ token: "tok123", expiresAt: 42, maxBytes: 5_242_880 });
    expect((result as { uploadUrl: string }).uploadUrl).toMatch(/\/j\/upload\/tok123$/);
  });

  it("deploy_jot hashes the password for a password jot", async () => {
    vi.mocked(readManifest).mockReturnValue(null);
    const tool = findTool("deploy_jot");
    await tool.handler({ userId: "u1" }, { name: "s", access: "password", password: "pw" });
    expect(hashPassword).toHaveBeenCalledWith("pw");
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({ access: "password", passwordHash: "scrypt$salt$hash" }));
  });

  it("deploy_jot errors if a password jot has no password", async () => {
    const tool = findTool("deploy_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "s", access: "password" });
    expect(result).toEqual({ error: "PASSWORD_REQUIRED" });
    expect(mint).not.toHaveBeenCalled();
  });

  it("deploy_jot rejects an invalid name", async () => {
    const tool = findTool("deploy_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "Bad Name", access: "public" });
    expect(result).toEqual({ error: "INVALID_NAME" });
    expect(mint).not.toHaveBeenCalled();
  });

  it("deploy_jot refuses a name owned by another user", async () => {
    vi.mocked(readManifest).mockReturnValue({ access: "public", owner: "someone-else", createdAt: "t", updatedAt: "t" });
    const tool = findTool("deploy_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "taken", access: "public" });
    expect(result).toEqual({ error: "JOT_NAME_TAKEN" });
    expect(mint).not.toHaveBeenCalled();
  });

  it("list_jots returns the caller's jots", async () => {
    vi.mocked(store.listJots).mockReturnValue([{ name: "r", access: "public", url: "https://wb.test/j/r/", updatedAt: "t" }]);
    const tool = findTool("list_jots");
    const result = await tool.handler({ userId: "u1" }, {});
    expect(store.listJots).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ jots: [{ name: "r", access: "public", url: "https://wb.test/j/r/", updatedAt: "t" }] });
  });

  it("delete_jot forwards owner + name", async () => {
    vi.mocked(store.deleteJot).mockReturnValue({ ok: true });
    const tool = findTool("delete_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "r" });
    expect(store.deleteJot).toHaveBeenCalledWith("r", "u1");
    expect(result).toEqual({ ok: true });
  });
});
