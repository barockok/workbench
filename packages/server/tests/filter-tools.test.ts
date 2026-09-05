import { describe, it, expect } from "vitest";
import { z } from "zod";
import { filterTools } from "../src/plugins/loader";

const tool = (name: string) => ({
  name,
  description: `${name} description`,
  inputSchema: z.object({ q: z.string() }),
  handler: async () => ({ ok: true }),
});

describe("filterTools", () => {
  it("finds tools exported by name", () => {
    const found = filterTools({ alpha: tool("alpha"), beta: tool("beta") });
    expect(found.map((t) => t.name).sort()).toEqual(["alpha", "beta"]);
  });

  // The shape a CJS-transpiled plugin actually presents when the compiled
  // server imports its .ts through tsx: the tools sit under `default`, not at
  // the top level. Every directory-loaded plugin reported zero tools because
  // only the top level was searched.
  it("finds tools nested under a default export", () => {
    const found = filterTools({ default: { alpha: tool("alpha"), beta: tool("beta") } });
    expect(found.map((t) => t.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("finds tools under the module.exports namespace key", () => {
    const found = filterTools({ "module.exports": { alpha: tool("alpha") } });
    expect(found.map((t) => t.name)).toEqual(["alpha"]);
  });

  it("does not double-count a tool reachable by two paths", () => {
    const shared = tool("alpha");
    const found = filterTools({ alpha: shared, default: { alpha: shared } });
    expect(found).toHaveLength(1);
  });

  it("ignores exports that are not tools", () => {
    const found = filterTools({
      helper: () => "not a tool",
      config: { name: "x" },
      schemaOnly: { name: "y", inputSchema: z.string() },
      handlerOnly: { name: "z", handler: async () => null },
    });
    expect(found).toEqual([]);
  });
});
