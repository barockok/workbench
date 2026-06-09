import { describe, it, expect } from "vitest";
import { contentType } from "../../src/jots/mime";

describe("jots/mime", () => {
  it("maps known extensions", () => {
    expect(contentType("a/index.html")).toBe("text/html; charset=utf-8");
    expect(contentType("app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentType("data.json")).toBe("application/json; charset=utf-8");
    expect(contentType("logo.svg")).toBe("image/svg+xml");
  });
  it("falls back to octet-stream", () => {
    expect(contentType("file.unknownext")).toBe("application/octet-stream");
  });
});
