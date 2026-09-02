// Only ever an in-app path. A stored value is never trusted as a URL: a
// protocol-relative form ("//host") or a backslash form ("/\host", which some
// browsers normalize to "//host") would navigate off-origin after login.
export function safeReturnPath(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}
