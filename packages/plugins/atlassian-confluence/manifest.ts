export default {
  name: "atlassian-confluence",
  version: "1.0.0",
  auth: {
    type: "oauth2",
    authorizationUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scopes: [
      "read:confluence-content.summary",
      "write:confluence-content",
      "search:confluence",
      "read:confluence-space.summary",
      "offline_access",
    ],
  },
};
