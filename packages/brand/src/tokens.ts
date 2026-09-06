// Mirrors packages/shared/styles/tokens.css. A change here must be made there too;
// tokens.test.ts pins the values so the two cannot drift silently.
export const tokens = {
  accent: "#853291",
  accentDark: "#c98ad2",
  accentSoft: "#fef3ff",
  accentLine: "#e5b8ef",
} as const;

// Hero palettes. Index 0–1 are the rim (lightest), 2–6 the body spread, 7 the
// single warm counter-colour — about one body dot in six and one big ambient
// shape in three, which is what the approved prototype uses.
export const SWARM_PALETTES = {
  dark:   ["#ffffff", "#f3dcff", "#e5b8ef", "#c98ad2", "#ff8de6", "#a45bb0", "#853291", "#ffb340"],
  accent: ["#ffffff", "#fbeaff", "#f0c9f8", "#e5b8ef", "#ffa3ec", "#d49be0", "#c98ad2", "#ffc36b"],
} as const satisfies Record<string, readonly string[]>;

export type SwarmGround = keyof typeof SWARM_PALETTES;
