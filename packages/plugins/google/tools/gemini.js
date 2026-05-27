"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateContent = void 0;
const zod_1 = require("zod");
exports.generateContent = {
    name: "google_gemini_generate",
    description: "Generate content with Google Gemini",
    integration: "google",
    inputSchema: zod_1.z.object({
        prompt: zod_1.z.string(),
        model: zod_1.z.string().default("gemini-1.5-flash"),
    }),
    handler: async (ctx, args) => {
        const res = await ctx.http(`https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: args.prompt }] }],
            }),
        });
        return res.json();
    },
};
