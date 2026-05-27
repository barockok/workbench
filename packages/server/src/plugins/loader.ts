import fs from "fs";
import path from "path";
import { config } from "../config";
import { registry } from "./registry";

const builtinPlugins = [
  "google",
  "atlassian-jira",
  "atlassian-confluence",
  "atlassian-bitbucket",
  "asana",
  "github",
  "slack",
  "postgres",
];

function findPluginsBasePath(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), "../plugins"),
    path.resolve(process.cwd(), "../../plugins"),
    path.resolve(process.cwd(), "plugins"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function filterTools(module: Record<string, unknown>) {
  return Object.values(module).filter(
    (v): v is { name: string; description: string; integration: string; inputSchema: unknown; handler: (ctx: unknown, args: unknown) => Promise<unknown> } =>
      typeof v === "object" &&
      v !== null &&
      "name" in v &&
      "handler" in v &&
      typeof (v as Record<string, unknown>).handler === "function"
  );
}

async function loadBuiltin(pluginName: string, basePath: string): Promise<void> {
  const pluginPath = path.join(basePath, pluginName);

  try {
    const manifestMod = await import(path.join(pluginPath, "manifest"));
    const toolsMod = await import(path.join(pluginPath, "tools/index"));

    registry.register({
      integration: manifestMod.default,
      tools: filterTools(toolsMod),
    });
  } catch (e) {
    console.error(`Failed to load built-in plugin ${pluginName}:`, e);
  }
}

export async function loadPlugins(): Promise<void> {
  const basePath = findPluginsBasePath();
  if (basePath) {
    for (const name of builtinPlugins) {
      await loadBuiltin(name, basePath);
    }
  }

  // Dynamically load from plugins directory if it exists
  const pluginsDir = config.PLUGINS_DIR;
  if (!fs.existsSync(pluginsDir)) return;

  const dirs = fs.readdirSync(pluginsDir).filter((d) =>
    fs.statSync(path.join(pluginsDir, d)).isDirectory()
  );

  for (const dir of dirs) {
    const pluginPath = path.join(pluginsDir, dir);
    try {
      const manifestMod = await import(path.join(pluginPath, "manifest"));
      const toolsMod = await import(path.join(pluginPath, "tools/index"));
      registry.register({
        integration: manifestMod.default,
        tools: filterTools(toolsMod),
      });
      console.log(`Loaded plugin: ${dir}`);
    } catch (e) {
      console.error(`Failed to load plugin ${dir}:`, e);
    }
  }
}
