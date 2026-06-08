import { describe, it, expect } from "vitest";
import { config } from "../src/config";

describe("config BROWSER_SESSION_TTL_SECONDS", () => {
  it("defaults to 300 seconds", () => {
    expect(config.BROWSER_SESSION_TTL_SECONDS).toBe(300);
  });
  it("is a positive integer", () => {
    expect(Number.isInteger(config.BROWSER_SESSION_TTL_SECONDS)).toBe(true);
    expect(config.BROWSER_SESSION_TTL_SECONDS).toBeGreaterThan(0);
  });
});
