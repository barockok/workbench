import fs from "fs";
import path from "path";
import { config } from "../config";
import { registry } from "./registry";

export async function loadPlugins(): Promise<void> {
  const pluginsDir = config.PLUGINS_DIR;
  if (!fs.existsSync(pluginsDir)) return;

  const dirs = fs.readdirSync(pluginsDir).filter((d) =>
    fs.statSync(path.join(pluginsDir, d)).isDirectory()
  );

  for (const dir of dirs) {
    const pluginPath = path.join(pluginsDir, dir);
    try {
      const mod = await import(path.join(pluginPath, "manifest.ts"));
      console.log(`Loaded plugin: ${dir}`);
    } catch (e) {
      console.error(`Failed to load plugin ${dir}:`, e);
    }
  }
}
