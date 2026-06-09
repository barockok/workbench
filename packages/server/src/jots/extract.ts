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
// from file paths). Rejects with a JotExtractError on any violation.
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

    const fail = (code: JotExtractCode) => {
      if (settled) return;
      settled = true;
      ex.destroy();
      gunzip.destroy();
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
        stream.resume();
        return fail("UNSUPPORTED_ENTRY");
      }
      const rel = safeRelPath(header.name);
      if (!rel) {
        stream.resume();
        return fail("INVALID_PATH");
      }
      if (fileCount + 1 > config.JOTS_MAX_FILES) {
        stream.resume();
        return fail("TOO_MANY_FILES");
      }
      fileCount++;
      const dest = join(destDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      const ws = createWriteStream(dest);
      ws.on("error", () => fail("BAD_ARCHIVE"));
      stream.on("error", () => fail("BAD_ARCHIVE"));
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > config.JOTS_MAX_BYTES) {
          ws.destroy();
          fail("TOO_LARGE");
        }
      });
      ws.on("close", () => {
        if (!settled) next();
      });
      stream.pipe(ws);
    });

    ex.on("finish", () => {
      if (settled) return;
      if (fileCount === 0) {
        settled = true;
        return reject(new JotExtractError("NO_FILES"));
      }
      settled = true;
      resolve({ fileCount, bytes });
    });

    src.pipe(gunzip).pipe(ex);
  });
}
