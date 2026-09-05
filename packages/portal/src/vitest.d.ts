import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

// jest-dom ships its own augmentation, but it declares `interface Assertion`
// inside `declare module "vitest"`. From vitest 4 that no longer merges: vitest
// re-exports Assertion from @vitest/expect rather than declaring it, so the
// augmentation silently created a second, empty interface and every matcher
// (toBeInTheDocument, toHaveClass, …) failed to type-check while working fine at
// runtime. Augmenting the module that actually declares the interface fixes it.
declare module "@vitest/expect" {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
