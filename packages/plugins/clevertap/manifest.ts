export default {
  name: "clevertap",
  version: "1.0.0",
  displayName: "CleverTap",
  description: "Mobile analytics — profiles, events, campaigns, and reports (read-only).",
  categories: ["analytics", "marketing"],
  auth: {
    type: "apikey" as const,
    headerName: "X-CleverTap-Account-Id",
    allowedHosts: ["clevertap.com"],
    fields: [
      {
        key: "projectsJson",
        label: "Projects JSON",
        placeholder: `[
  {
    "name": "production",
    "accountId": "XXX-XXX-XXXX",
    "passcode": "YYY-YYY-YYYY",
    "region": "us1"
  },
  {
    "name": "staging",
    "accountId": "AAA-AAA-AAAA",
    "passcode": "BBB-BBB-BBBB",
    "region": "eu1"
  }
]`,
        description:
          'Paste a JSON array of CleverTap projects (multiline). Each entry: { name, accountId, passcode, region }. Regions: in1/us1/eu1/sg1/aps3/mec1. Single or multi: [{"name":"prod","accountId":"XXX","passcode":"YYY","region":"us1"}]. Encrypted at rest. You can also set via MCP tool clevertap_set_projects.',
        secret: true,
        multiline: true,
      },
    ],
  },
};
