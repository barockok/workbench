import { z } from "zod";

export const searchToolsSchema = z.object({
  query: z.string().min(1),
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
  displayName: z.string().optional(),
  description: z.string().optional(),
  logo: z.string().optional(),
  categories: z.array(z.string()).optional(),
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
      allowedHosts: z.array(z.string()).optional(),
      fields: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          description: z.string().optional(),
          placeholder: z.string().optional(),
          secret: z.boolean().optional(),
          options: z.array(z.string()).optional(),
          optional: z.boolean().optional(),
          multiline: z.boolean().optional(),
        })
      ),
    }),
    z.object({
      type: z.literal("cookie"),
      loginUrl: z.string().url(),
      targetDomain: z.string(),
      cookieDomains: z.array(z.string()).optional(),
    }),
    z.object({
      type: z.literal("none"),
    }),
  ]),
});
