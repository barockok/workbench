import path from "node:path";
import { config } from "../config";

// Where jots live on disk. Mirrors the browser-profiles default: a sibling of
// the SQLite DB unless JOTS_DIR overrides it. Resolved (absolute) so the serve
// traversal guard can compare prefixes reliably.
export function jotsRoot(): string {
  const base = config.JOTS_DIR || path.join(path.dirname(config.DATABASE_URL), "jots");
  return path.resolve(base);
}
