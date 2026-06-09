import { describe, it, expect } from "vitest";
import path from "node:path";
import { jotsRoot } from "../../src/jots/dir";

describe("jotsRoot", () => {
  it("defaults to a 'jots' dir next to the database", () => {
    // DATABASE_URL defaults to ./data/tokens.db in test env
    expect(jotsRoot()).toBe(path.resolve(path.dirname("./data/tokens.db"), "jots"));
  });
});
