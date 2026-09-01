// Jots (static web artifact hosting) as an internal registry plugin. Lives in
// server source — NOT under PLUGINS_DIR — because the handlers reach straight
// into the jots store/filesystem, which must stay out of the plugin
// ToolContext.
import { z } from "zod";
import { Plugin, PluginTool } from "../registry";
import { config } from "../../config";
import { listJots, deleteJot, readManifest, listJotFiles } from "../../jots/store";
import { hashPassword } from "../../jots/auth";
import { isValidJotName, safeRelPath } from "../../jots/paths";
import { mint } from "../../jots/pending";

export const JOTS_INTEGRATION_NAME = "jots";

const tools: PluginTool[] = [
  {
    name: "deploy_jot",
    description:
      "Begin deploying a static web artifact to /j/<name>/. Returns an upload URL and a single-use token (valid ~5 min). Package your site directory as a gzip tarball and upload it, e.g.: `tar czf - -C <dir> . | curl --data-binary @- -H 'Content-Type: application/gzip' <uploadUrl>`. The archive's root must contain an index.html (served at /j/<name>/) — an upload without one is rejected (NO_INDEX). The archive is extracted server-side and published wholesale, replacing any previous deploy. `access` is 'public' or 'password' (password jots require `password`). Set `cors: true` on a public jot to let its own scripts (and other sites) fetch its files — jot pages are sandboxed onto an opaque origin, so without it a page cannot even fetch its own JSON. Names are global and creator-locked: a name owned by another user returns JOT_NAME_TAKEN. Limits: <=5 MiB decompressed, <=1000 files. Jot pages are sandboxed (opaque origin) and must be self-contained.",
    integration: JOTS_INTEGRATION_NAME,
    inputSchema: z.object({
      name: z.string(),
      access: z.enum(["public", "password"]),
      password: z.string().optional(),
      cors: z.boolean().optional(),
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
        cors: args.cors === true ? true : undefined,
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
    name: "update_jot",
    description:
      "Begin a partial update of a jot you already own: the archive you upload is overlaid onto the live site instead of replacing it, so files you don't mention are left alone. Use this to refresh one data file (e.g. a weekly data.json) without re-uploading the whole site. Returns an upload URL and a single-use token (valid ~5 min); upload the same way as deploy_jot, e.g.: `tar czf - -C <dir> data.json | curl --data-binary @- -H 'Content-Type: application/gzip' <uploadUrl>`. Pass `delete` to remove paths (a directory removes its contents); a path that is both deleted and uploaded keeps the uploaded version. Call list_jot_files first if you need to see the current tree. Access and password are inherited from the live jot and cannot be changed here — redeploy for that. The merged tree still has to fit the <=5 MiB / <=1000 file limits.",
    integration: JOTS_INTEGRATION_NAME,
    inputSchema: z.object({
      name: z.string(),
      delete: z.array(z.string()).optional(),
      cors: z.boolean().optional(),
    }),
    handler: async (ctx: any, args: any) => {
      if (!isValidJotName(args.name)) return { error: "INVALID_NAME" };
      const existing = readManifest(args.name);
      if (!existing) return { error: "NOT_FOUND" };
      if (existing.owner !== ctx.userId) return { error: "FORBIDDEN" };
      const deletes: string[] = [];
      for (const d of args.delete ?? []) {
        const rel = safeRelPath(d);
        if (!rel) return { error: "INVALID_PATH" };
        deletes.push(rel);
      }
      const { token, expiresAt } = mint({
        owner: ctx.userId,
        name: args.name,
        mode: "patch",
        deletes,
        cors: args.cors === true ? true : undefined,
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
    name: "list_jot_files",
    description:
      "List the files inside a jot you own (path, bytes, updatedAt), so you can see the current structure before making a partial update with update_jot. Returns FORBIDDEN if another user owns it, NOT_FOUND if it doesn't exist.",
    integration: JOTS_INTEGRATION_NAME,
    inputSchema: z.object({ name: z.string() }),
    handler: async (ctx: any, args: any) => listJotFiles(args.name, ctx.userId),
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
