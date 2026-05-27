import { z } from "zod";

export const searchToolsSchema = z.object({
  query: z.string().min(1),
});

export const executeToolSchema = z.object({
  tool: z.string(),
  args: z.record(z.unknown()),
});

export const getToolSchema = z.object({
  tool: z.string(),
});

export const getAuthUrlSchema = z.object({
  integration: z.string(),
});

export const integrationSchema = z.object({
  name: z.string(),
  version: z.string(),
  auth: z.union([
    z.object({
      type: z.literal("oauth2"),
      authorizationUrl: z.string().url(),
      tokenUrl: z.string().url(),
      scopes: z.array(z.string()),
    }),
    z.object({
      type: z.literal("apikey"),
      headerName: z.string(),
    }),
    z.object({
      type: z.literal("none"),
    }),
  ]),
});
