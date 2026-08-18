export default {
  name: "atlassian-jira",
  version: "1.0.0",
  displayName: "Jira",
  description: "Issue tracking and agile project management.",
  logo: "logo.svg",
  categories: ["dev","productivity"],
  auth: {
    type: "oauth2",
    authorizationUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scopes: [
      "read:jira-work",
      "write:jira-work",
      "read:board-scope:jira-software",
      "read:me",
      "read:jira-user",
      "offline_access",
    ],
  },
  // ctx.http() auto-resolves "cloud-id" to the real Atlassian cloud id.
  proxy: { baseUrl: "https://api.atlassian.com/ex/jira/cloud-id" },
};
