export default {
  name: "atlassian-confluence",
  version: "1.0.0",
  displayName: "Confluence",
  description: "Team wiki — pages, spaces, and documentation.",
  logo: "logo.svg",
  categories: ["docs","productivity"],
  auth: {
    type: "oauth2",
    authorizationUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    // Granular scopes — required by the v2 REST API (`/wiki/api/v2/...`).
    // The classic `*:confluence-content`/`*:confluence-space.summary` scopes
    // only authorize the removed v1 content API. `search:confluence` (already
    // granular) backs the CQL search endpoint that search_pages still uses.
    // NOTE: changing scopes requires existing users to reconnect/reconsent.
    scopes: [
      "read:page:confluence",
      "write:page:confluence",
      "delete:page:confluence",
      "read:space:confluence",
      "search:confluence",
      "offline_access",
    ],
  },
};
