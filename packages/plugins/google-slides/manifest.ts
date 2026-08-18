export default {
  name: "google-slides",
  version: "1.0.0",
  displayName: "Google Slides",
  description: "Build and edit presentations.",
  logo: "logo.svg",
  categories: ["google","docs"],
  auth: {
    type: "oauth2",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/presentations",
      "https://www.googleapis.com/auth/drive.file",
    ],
  },
  proxy: { baseUrl: "https://slides.googleapis.com/v1" },
};
