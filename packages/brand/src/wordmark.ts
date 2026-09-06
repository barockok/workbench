// Lockup layout. The portal's BrandLockup and the site header both read these
// so the mark/wordmark relationship is defined once.
export const LOCKUP = {
  gap: 8,
  standard: { mark: 24, wordmark: 16 },
  compact: { mark: 20, wordmark: 14 },
  name: "workbench",
} as const;
