export default {
  name: "asana",
  version: "1.0.0",
  auth: {
    type: "oauth2",
    authorizationUrl: "https://app.asana.com/-/oauth_authorize",
    tokenUrl: "https://app.asana.com/-/oauth_token",
    scopes: ["default"],
  },
};
