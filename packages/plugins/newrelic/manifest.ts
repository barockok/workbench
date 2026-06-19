export default {
  name: "newrelic",
  version: "1.0.0",
  displayName: "New Relic",
  description:
    "Observability — alert policies, NRQL conditions, dashboards, entity tags, and AI notifications via NerdGraph.",
  logo: "logo.svg",
  categories: ["observability", "dev"],
  auth: {
    type: "apikey",
    // NerdGraph authenticates with the user API key in the `Api-Key` header.
    headerName: "Api-Key",
    // All tool traffic goes to NerdGraph (see ENDPOINTS in tools/index.ts); pin
    // the key to New Relic's hosts so it can never leak to another destination.
    allowedHosts: ["api.newrelic.com", "api.eu.newrelic.com"],
    fields: [
      {
        key: "apiKey",
        label: "New Relic User API Key",
        description: "The User API key for authenticating requests to New Relic's APIs.",
        placeholder: "Enter New Relic User API Key",
        secret: true,
      },
      {
        key: "region",
        label: "Account Region",
        description:
          "The region of the New Relic account, either 'US' or 'EU'. This determines the base URL for API requests.",
        placeholder: "US",
        options: ["US", "EU"],
      },
      {
        key: "accountId",
        label: "Default Account ID",
        description:
          "Optional. The numeric account ID tools use when you don't pass accountId explicitly. A User API key can span multiple accounts, so leave blank to require accountId per call.",
        placeholder: "1234567",
        optional: true,
      },
    ],
  },
};
