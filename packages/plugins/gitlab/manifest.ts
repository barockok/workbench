export default {
  name: "gitlab",
  version: "1.0.0",
  displayName: "GitLab",
  description: "Code hosting — projects, issues, and merge requests. Works with gitlab.com and self-hosted instances.",
  logo: "logo.svg",
  categories: ["dev"],
  auth: {
    type: "oauth2",
    // Cloud default. For a self-hosted instance the server keeps these paths
    // (/oauth/authorize, /oauth/token) and swaps in the user's origin.
    authorizationUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    // `api` grants full read/write across projects, issues, MRs, and the
    // repository (needed for parity with the GitHub/Bitbucket plugins).
    scopes: ["api"],
    instance: {
      label: "GitLab instance URL",
      placeholder: "https://gitlab.example.com",
      default: "https://gitlab.com",
    },
  },
  // Base URL resolved at request time from the per-connection instanceUrl.
  proxy: { resolver: "instance-url", pathPrefix: "/api/v4" },
};
