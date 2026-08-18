export default {
  name: "google-calendar",
  version: "1.0.0",
  displayName: "Google Calendar",
  description: "Events and scheduling.",
  logo: "logo.svg",
  categories: ["google","productivity"],
  auth: {
    type: "oauth2",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/calendar"],
  },
  proxy: { baseUrl: "https://www.googleapis.com/calendar/v3" },
};
