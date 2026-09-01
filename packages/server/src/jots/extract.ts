import { createGunzip } from "node:zlib";
import { extract as tarExtract } from "tar-stream";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { config } from "../config";
import { safeRelPath } from "./paths";

export type JotExtractCode =
  | "INVALID_PATH"
  | "UNSUPPORTED_ENTRY"
  | "TOO_LARGE"
  | "TOO_MANY_FILES"
  | "BAD_ARCHIVE"
  | "NO_FILES";

export class JotExtractError extends Error {
  constructor(public code: JotExtractCode) {
    super(code);
    this.name = "JotExtractError";
  }
}

// Stream an uploaded gzip tarball into destDir, applying safety guards. Only
// regular files are written; directory entries are ignored (parents are created
// from file paths). Rejects with a JotExtractError on any violation. On failure,
// destDir may contain partial output; the caller is responsible for discarding it.
export function extractTarGzToDir(
  src: Readable,
  destDir: string
): Promise<{ fileCount: number; bytes: number }> {
  return new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const ex = tarExtract();
    let bytes = 0;
    let fileCount = 0;
    let settled = false;
    let activeWs: import("node:fs").WriteStream | null = null;

    const fail = (code: JotExtractCode) => {
      if (settled) return;
      settled = true;
      ex.destroy();
      gunzip.destroy();
      try { activeWs?.destroy(); } catch { /* noop */ }
      reject(new JotExtractError(code));
    };

    gunzip.on("error", () => fail("BAD_ARCHIVE"));
    ex.on("error", () => fail("BAD_ARCHIVE"));
    src.on("error", () => fail("BAD_ARCHIVE"));

    ex.on("entry", (header, stream, next) => {
      if (settled) {
        stream.resume();
        return;
      }
      if (header.type === "directory") {
        stream.on("end", next);
        stream.resume();
        return;
      }
      if (header.type !== "file") {
        return fail("UNSUPPORTED_ENTRY");
      }
      const rel = safeRelPath(header.name);
      if (!rel) {
        return fail("INVALID_PATH");
      }
      if (fileCount + 1 > config.JOTS_MAX_FILES) {
        return fail("TOO_MANY_FILES");
      }
      fileCount++;
      const dest = join(destDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      const ws = createWriteStream(dest);
      activeWs = ws;
      ws.on("error", () => fail("BAD_ARCHIVE"));
      stream.on("error", () => fail("BAD_ARCHIVE"));
      stream.on("data", (chunk: any) => {
        bytes += (chunk as Buffer).length;
        if (bytes > config.JOTS_MAX_BYTES) {
          ws.destroy();
          fail("TOO_LARGE");
        }
      });
      ws.on("close", () => {
        activeWs = null;
        if (!settled) next();
      });
      stream.pipe(ws);
    });

    ex.on("finish", () => {
      if (settled) return;
      if (fileCount === 0) {
        return fail("NO_FILES");
      }
      settled = true;
      resolve({ fileCount, bytes });
    });

    src.pipe(gunzip).pipe(ex);
  });
}
