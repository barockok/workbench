import { describe, it, expect } from "vitest";
import { tokens, SWARM_PALETTES } from "../src/tokens";
import { LOCKUP } from "../src/wordmark";

describe("tokens", () => {
  it("matches the accent family the portal and docs already use", () => {
    expect(tokens.accent).toBe("#853291");
    expect(tokens.accentDark).toBe("#c98ad2");
  });
  it("each swarm palette has eight steps: two rim, five body, one amber", () => {
    for (const p of Object.values(SWARM_PALETTES)) expect(p).toHaveLength(8);
    expect(SWARM_PALETTES.dark[7]).toBe("#ffb340");
    expect(SWARM_PALETTES.accent[7]).toBe("#ffc36b");
  });
});

describe("LOCKUP", () => {
  it("compact sits one step below standard for both mark and wordmark", () => {
    expect(LOCKUP.standard).toEqual({ mark: 24, wordmark: 16 });
    expect(LOCKUP.compact).toEqual({ mark: 20, wordmark: 14 });
    expect(LOCKUP.gap).toBe(8);
  });
});
