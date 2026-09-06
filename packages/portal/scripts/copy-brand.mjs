// Copies the brand favicon into public/ so index.html can link it by path.
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "brand", "dist"), dst = join(here, "..", "public");
mkdirSync(dst, { recursive: true });
for (const f of ["favicon.svg", "apple-touch-180.png"]) copyFileSync(join(src, f), join(dst, f));
