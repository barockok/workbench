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
    // User scopes (sent as `user_scope` — token acts as the authorizing
    // user, not a bot). Must match the user scopes on the Slack app config.
    scopes: [
      "chat:write",
      "channels:read",
      "groups:read",
      "im:read",
      "mpim:read",
      "channels:history",
      "groups:history",
      "im:history",
      "mpim:history",
      "reactions:write",
      "users:read",
      "users:read.email",
      "files:write",
      "search:read",
    ],
  },
};
