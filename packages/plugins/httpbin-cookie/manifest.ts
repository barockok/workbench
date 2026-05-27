export default {
  name: "httpbin-cookie",
  version: "1.0.0",
  auth: {
    type: "cookie" as const,
    loginUrl: "https://httpbin.org/cookies/set?session=test123",
    targetDomain: "httpbin.org",
    cookieDomains: [".httpbin.org"],
  },
};
