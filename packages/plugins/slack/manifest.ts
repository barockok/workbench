export default {
  name: "slack",
  version: "1.0.0",
  displayName: "Slack",
  description: "Team chat — messages, channels, and files.",
  logo: "logo.svg",
  categories: ["comms"],
  auth: {
    type: "oauth2",
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["chat:write", "channels:read", "groups:read", "im:read", "mpim:read", "files:write", "users:read.email"],
  },
};
