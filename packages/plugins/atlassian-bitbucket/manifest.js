"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    name: "atlassian-bitbucket",
    version: "1.0.0",
    auth: {
        type: "oauth2",
        authorizationUrl: "https://bitbucket.org/site/oauth2/authorize",
        tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
        scopes: ["repository", "pullrequest:write", "account"],
    },
};
