export default {
  name: "asana",
  version: "1.0.0",
  displayName: "Asana",
  description: "Project & task management — projects, tasks, and assignments.",
  logo: "logo.svg",
  categories: ["productivity"],
  auth: {
    type: "oauth2",
    authorizationUrl: "https://app.asana.com/-/oauth_authorize",
    tokenUrl: "https://app.asana.com/-/oauth_token",
    scopes: ["default"],
  },
  proxy: { baseUrl: "https://app.asana.com/api/1.0" },
};
