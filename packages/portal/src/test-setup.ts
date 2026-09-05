import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Node 22+ ships an experimental native global `localStorage` (sqlite-backed,
// no .clear()/.getItem() without --localstorage-file) that otherwise shadows
// jsdom's real Storage implementation on this realm's `window`/`globalThis`.
// Disabled via NODE_OPTIONS=--no-experimental-webstorage in the `test` script
// (package.json) so jsdom's localStorage is what tests actually see.

afterEach(() => {
  cleanup();
});
