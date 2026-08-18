export default {
  name: "google-drive",
  version: "1.0.0",
  displayName: "Google Drive",
  description: "File storage and sharing.",
  logo: "logo.svg",
  categories: ["google","storage"],
  auth: {
    type: "oauth2",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/drive"],
  },
  proxy: { baseUrl: "https://www.googleapis.com/drive/v3" },
};
