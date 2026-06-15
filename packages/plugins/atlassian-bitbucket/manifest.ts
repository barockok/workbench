export default {
  name: "atlassian-bitbucket",
  version: "1.0.0",
  displayName: "Bitbucket",
  description: "Git repositories, pull requests, and code review.",
  logo: "logo.svg",
  categories: ["dev"],
  auth: {
    type: "oauth2",
    authorizationUrl: "https://bitbucket.org/site/oauth2/authorize",
    tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
    scopes: ["repository", "repository:write", "pullrequest:write", "pipeline", "pipeline:write", "account"],
  },
};
