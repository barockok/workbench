export default {
  name: "google-gemini",
  version: "1.0.0",
  displayName: "Google Gemini",
  description: "Gemini generative AI models.",
  logo: "logo.svg",
  categories: ["google","ai"],
  auth: {
    type: "oauth2",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/generative-language.retriever"],
  },
};
