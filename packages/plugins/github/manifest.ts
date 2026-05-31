export default {
  name: "github",
  version: "1.0.0",
  displayName: "GitHub",
  description: "Code hosting — repositories, issues, and pull requests.",
  logo: "logo.svg",
  categories: ["dev"],
  auth: {
    type: "oauth2",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:user", "read:org", "issues", "pull_requests"],
  },
};
