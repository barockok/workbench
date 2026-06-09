import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pack as tarPack } from "tar-stream";
import { createGzip } from "node:zlib";

vi.mock("../../src/config", () => ({
  config: { JOTS_MAX_BYTES: 1000, JOTS_MAX_FILES: 5 },
}));

import { extractTarGzToDir, JotExtractError } from "../../src/jots/extract";

interface Entry { name: string; content?: string; type?: "file" | "directory" | "symlink"; linkname?: string; }

function makeTarGz(entries: Entry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pack = tarPack();
    const gzip = createGzip();
    const chunks: Buffer[] = [];
    gzip.on("data", (c: Buffer) => chunks.push(c));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));
    gzip.on("error", reject);
    pack.pipe(gzip);
    (function next(i: number) {
      if (i >= entries.length) { pack.finalize(); return; }
      const e = entries[i];
      if (e.type === "directory") { pack.entry({ name: e.name, type: "directory" }); return next(i + 1); }
      if (e.type === "symlink") { pack.entry({ name: e.name, type: "symlink", linkname: e.linkname ?? "x" }); return next(i + 1); }
      pack.entry({ name: e.name }, e.content ?? "", () => next(i + 1));
    })(0);
  });
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jot-extract-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

async function run(entries: Entry[], dest = path.join(tmp, "out")) {
  fs.mkdirSync(dest, { recursive: true });
  const buf = await makeTarGz(entries);
  return extractTarGzToDir(Readable.from(buf), dest);
}

describe("jots/extract", () => {
  it("extracts files and nested dirs", async () => {
    const dest = path.join(tmp, "out");
    const res = await run([
      { name: "index.html", content: "<h1>hi</h1>" },
      { name: "assets/app.js", content: "console.log(1)" },
    ], dest);
    expect(res.fileCount).toBe(2);
    expect(fs.readFileSync(path.join(dest, "index.html"), "utf8")).toContain("hi");
    expect(fs.readFileSync(path.join(dest, "assets/app.js"), "utf8")).toContain("console.log");
  });

  it("rejects a path-traversal entry", async () => {
    await expect(run([{ name: "../escape.txt", content: "x" }])).rejects.toMatchObject({ code: "INVALID_PATH" });
  });

  it("rejects a symlink entry", async () => {
    await expect(run([{ name: "link", type: "symlink", linkname: "../../etc/passwd" }]))
      .rejects.toMatchObject({ code: "UNSUPPORTED_ENTRY" });
  });

  it("aborts when decompressed bytes exceed the cap", async () => {
    await expect(run([{ name: "big.bin", content: "x".repeat(2000) }]))
      .rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("rejects too many files", async () => {
    const entries: Entry[] = [];
    for (let i = 0; i < 6; i++) entries.push({ name: `f${i}.txt`, content: "x" });
    await expect(run(entries)).rejects.toMatchObject({ code: "TOO_MANY_FILES" });
  });

  it("rejects an empty archive", async () => {
    await expect(run([])).rejects.toMatchObject({ code: "NO_FILES" });
  });

  it("rejects a non-gzip body", async () => {
    const dest = path.join(tmp, "out");
    fs.mkdirSync(dest, { recursive: true });
    await expect(extractTarGzToDir(Readable.from(Buffer.from("not a gzip")), dest))
      .rejects.toMatchObject({ code: "BAD_ARCHIVE" });
  });

  it("is a JotExtractError instance", async () => {
    const err = await run([{ name: "../x", content: "y" }]).catch((e) => e);
    expect(err).toBeInstanceOf(JotExtractError);
  });
});
