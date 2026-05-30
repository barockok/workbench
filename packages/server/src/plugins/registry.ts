import { ToolDefinition, Integration } from "@a-workbench/shared";
import { z } from "zod";

export interface PluginTool extends ToolDefinition {
  // Narrow the base `unknown` to a real Zod schema so callers (e.g.
  // execute_tool) can `.safeParse` args without hand-rolled casts.
  inputSchema: z.ZodTypeAny;
  handler: (ctx: unknown, args: unknown) => Promise<unknown>;
}

export interface Plugin {
  integration: Integration;
  tools: PluginTool[];
}

class Registry {
  private plugins = new Map<string, Plugin>();
  private tools = new Map<string, PluginTool>();

  register(plugin: Plugin): void {
    this.plugins.set(plugin.integration.name, plugin);
    for (const tool of plugin.tools) {
      this.tools.set(tool.name, tool);
    }
  }

  getTool(name: string): PluginTool | undefined {
    return this.tools.get(name);
  }

  getIntegration(name: string): Integration | undefined {
    return this.plugins.get(name)?.integration;
  }

  listIntegrations(): Integration[] {
    return Array.from(this.plugins.values()).map((p) => p.integration);
  }

  listTools(): PluginTool[] {
    return Array.from(this.tools.values());
  }

  searchTools(query: string): PluginTool[] {
    const q = query.toLowerCase();
    return this.listTools().filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
    );
  }
}

export const registry = new Registry();
