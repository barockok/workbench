export default {
  name: "google-docs",
  version: "1.0.0",
  displayName: "Google Docs",
  description: "Create and edit documents.",
  logo: "logo.svg",
  categories: ["google","docs"],
  auth: {
    type: "oauth2",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.file",
    ],
  },
};
