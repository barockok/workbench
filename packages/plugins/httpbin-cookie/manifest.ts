export default {
  name: "httpbin-cookie",
  version: "1.0.0",
  displayName: "HTTPBin (cookie demo)",
  description: "Reference cookie-auth plugin for testing.",
  // No logo on purpose — exercises the portal's default cog fallback.
  categories: ["demo"],
  auth: {
    type: "cookie" as const,
    loginUrl: "https://httpbin.org/cookies/set?session=test123",
    targetDomain: "httpbin.org",
    cookieDomains: [".httpbin.org"],
  },
};
