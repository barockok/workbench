"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    name: "atlassian-jira",
    version: "1.0.0",
    auth: {
        type: "oauth2",
        authorizationUrl: "https://auth.atlassian.com/authorize",
        tokenUrl: "https://auth.atlassian.com/oauth/token",
        scopes: ["read:jira-work", "write:jira-work", "read:me"],
    },
};
