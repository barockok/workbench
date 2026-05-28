export default {
  name: "google-sheets",
  version: "1.0.0",
  auth: {
    type: "oauth2",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      // Drive scope needed for spreadsheet creation/search by metadata
      "https://www.googleapis.com/auth/drive.file",
    ],
  },
};
