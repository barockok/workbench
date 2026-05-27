export default {
  name: "github",
  version: "1.0.0",
  auth: {
    type: "oauth2",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:user", "read:org", "issues", "pull_requests"],
  },
};
