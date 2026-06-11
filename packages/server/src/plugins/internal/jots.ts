// Jots (static web artifact hosting) as an internal registry plugin. Lives in
// server source — NOT under PLUGINS_DIR — because the handlers reach straight
// into the jots store/filesystem, which must stay out of the plugin
// ToolContext.
import { z } from "zod";
import { Plugin, PluginTool } from "../registry";
import { config } from "../../config";
import { listJots, deleteJot, readManifest } from "../../jots/store";
import { hashPassword } from "../../jots/auth";
import { isValidJotName } from "../../jots/paths";
import { mint } from "../../jots/pending";

export const JOTS_INTEGRATION_NAME = "jots";

const tools: PluginTool[] = [
  {
    name: "deploy_jot",
    description:
      "Begin deploying a static web artifact to /j/<name>/. Returns an upload URL and a single-use token (valid ~5 min). Package your site directory as a gzip tarball and upload it, e.g.: `tar czf - -C <dir> . | curl --data-binary @- -H 'Content-Type: application/gzip' <uploadUrl>`. The archive's root must contain an index.html (served at /j/<name>/) — an upload without one is rejected (NO_INDEX). The archive is extracted server-side and published wholesale, replacing any previous deploy. `access` is 'public' or 'password' (password jots require `password`). Names are global and creator-locked: a name owned by another user returns JOT_NAME_TAKEN. Limits: <=5 MiB decompressed, <=1000 files. Jot pages are sandboxed (opaque origin) and must be self-contained.",
    integration: JOTS_INTEGRATION_NAME,
    inputSchema: z.object({
      name: z.string(),
      access: z.enum(["public", "password"]),
      password: z.string().optional(),
    }),
    handler: async (ctx: any, args: any) => {
      if (!isValidJotName(args.name)) return { error: "INVALID_NAME" };
      if (args.access === "password" && !args.password) return { error: "PASSWORD_REQUIRED" };
      const existing = readManifest(args.name);
      if (existing && existing.owner !== ctx.userId) return { error: "JOT_NAME_TAKEN" };
      const passwordHash = args.access === "password" ? hashPassword(args.password as string) : undefined;
      const { token, expiresAt } = mint({
        owner: ctx.userId,
        name: args.name,
        access: args.access,
        passwordHash,
      });
      return {
        uploadUrl: `${config.SERVER_PUBLIC_URL}/j/upload/${token}`,
        token,
        expiresAt,
        maxBytes: config.JOTS_MAX_BYTES,
      };
    },
  },
  {
    name: "list_jots",
    description: "List the jots you have deployed (name, access, url, updatedAt). Only your own jots are returned.",
    integration: JOTS_INTEGRATION_NAME,
    inputSchema: z.object({}),
    handler: async (ctx: any) => ({ jots: listJots(ctx.userId) }),
  },
  {
    name: "delete_jot",
    description: "Delete a jot you own by name. Returns FORBIDDEN if another user owns it, NOT_FOUND if it doesn't exist.",
    integration: JOTS_INTEGRATION_NAME,
    inputSchema: z.object({ name: z.string() }),
    handler: async (ctx: any, args: any) => deleteJot(args.name, ctx.userId),
  },
];

export const jotsPlugin: Plugin = {
  integration: {
    name: JOTS_INTEGRATION_NAME,
    version: "1.0.0",
    auth: { type: "none" },
    displayName: "Jots",
    description:
      "Built-in static hosting: deploy self-contained web artifacts to /j/<name>/, public or password-gated.",
    categories: ["hosting"],
  },
  tools,
};
