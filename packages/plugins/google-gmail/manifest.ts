export default {
  name: "google-gmail",
  version: "1.0.0",
  displayName: "Gmail",
  description: "Email — read, send, and manage messages.",
  logo: "logo.svg",
  categories: ["google","comms"],
  auth: {
    type: "oauth2",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  },
};
