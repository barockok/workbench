import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/jots/store", () => ({
  deployJot: vi.fn(),
  listJots: vi.fn(),
  deleteJot: vi.fn(),
}));
vi.mock("../src/jots/auth", () => ({
  hashPassword: vi.fn(() => "scrypt$salt$hash"),
}));

import { metaTools } from "../src/mcp/meta-tools";
import * as store from "../src/jots/store";
import { hashPassword } from "../src/jots/auth";

function findTool(name: string) {
  return metaTools.find((t) => t.name === name)!;
}

describe("meta-tools jots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deploy_jot forwards a public deploy and returns the store result", async () => {
    vi.mocked(store.deployJot).mockReturnValue({ name: "r", access: "public", url: "https://wb.test/j/r/" });
    const tool = findTool("deploy_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "r", access: "public", files: [{ path: "index.html", content: "x" }] });
    expect(store.deployJot).toHaveBeenCalledWith({ name: "r", owner: "u1", access: "public", passwordHash: undefined, files: [{ path: "index.html", content: "x" }] });
    expect(result).toEqual({ name: "r", access: "public", url: "https://wb.test/j/r/" });
  });

  it("deploy_jot hashes the password for a password jot", async () => {
    vi.mocked(store.deployJot).mockReturnValue({ name: "s", access: "password", url: "https://wb.test/j/s/" });
    const tool = findTool("deploy_jot");
    await tool.handler({ userId: "u1" }, { name: "s", access: "password", password: "pw", files: [{ path: "index.html", content: "x" }] });
    expect(hashPassword).toHaveBeenCalledWith("pw");
    expect(store.deployJot).toHaveBeenCalledWith(expect.objectContaining({ access: "password", passwordHash: "scrypt$salt$hash" }));
  });

  it("deploy_jot errors if a password jot has no password", async () => {
    const tool = findTool("deploy_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "s", access: "password", files: [{ path: "index.html", content: "x" }] });
    expect(result).toEqual({ error: "PASSWORD_REQUIRED" });
    expect(store.deployJot).not.toHaveBeenCalled();
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
