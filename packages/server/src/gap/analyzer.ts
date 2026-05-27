import fs from "fs";
import path from "path";
import { composioTargets, nextPlugins } from "./catalog";

export interface GapResult {
  app: string;
  current: number;
  target: number;
  missing: string[];
  coverage: number;
}

export interface AnalysisReport {
  totalCurrent: number;
  totalTarget: number;
  overallCoverage: number;
  results: GapResult[];
  nextPlugins: { app: string; categories: string[] }[];
  keyGaps: string[];
}

function findPluginsBasePath(): string {
  const candidates = [
    path.resolve(__dirname, "../../../plugins"),
    path.resolve(__dirname, "../../../../plugins"),
    path.resolve(process.cwd(), "packages/plugins"),
    path.resolve(process.cwd(), "plugins"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("Plugins directory not found");
}

function countToolsInPlugin(pluginPath: string): number {
  const toolsDir = path.join(pluginPath, "tools");
  if (!fs.existsSync(toolsDir)) return 0;

  const files = fs.readdirSync(toolsDir).filter((f) => f.endsWith(".ts") && f !== "index.ts");
  let count = 0;

  for (const file of files) {
    const content = fs.readFileSync(path.join(toolsDir, file), "utf-8");
    // Count tool definitions by handler occurrences
    const toolMatches = content.match(/handler\s*:\s*async/g);
    if (toolMatches) {
      count += toolMatches.length;
    }
  }

  return count;
}

export async function analyzeGaps(): Promise<AnalysisReport> {
  const basePath = findPluginsBasePath();
  const pluginDirs = fs
    .readdirSync(basePath)
    .filter((d) => fs.statSync(path.join(basePath, d)).isDirectory());

  const results: GapResult[] = [];
  let totalCurrent = 0;
  let totalTarget = 0;

  for (const target of composioTargets) {
    const pluginPath = path.join(basePath, target.app);
    const current = fs.existsSync(pluginPath) ? countToolsInPlugin(pluginPath) : 0;
    totalCurrent += current;
    totalTarget += target.totalTools;

    results.push({
      app: target.app,
      current,
      target: target.totalTools,
      missing: target.missing,
      coverage: target.totalTools > 0 ? Math.round((current / target.totalTools) * 100) : 0,
    });
  }

  // Apps in workbench but not in catalog
  for (const dir of pluginDirs) {
    if (!composioTargets.find((t) => t.app === dir)) {
      const current = countToolsInPlugin(path.join(basePath, dir));
      results.push({
        app: dir,
        current,
        target: 0,
        missing: [],
        coverage: 100,
      });
    }
  }

  const overallCoverage = totalTarget > 0 ? Math.round((totalCurrent / totalTarget) * 100) : 0;

  return {
    totalCurrent,
    totalTarget,
    overallCoverage,
    results,
    nextPlugins,
    keyGaps: deriveKeyGaps(results),
  };
}

function deriveKeyGaps(results: GapResult[]): string[] {
  const gaps: string[] = [];

  const lowCoverage = results.filter((r) => r.coverage < 50 && r.target > 0);
  if (lowCoverage.length > 0) {
    gaps.push(
      `Low coverage apps (${lowCoverage.map((r) => r.app).join(", ")}) — need search/filter and update/delete tools`
    );
  }

  const missingUpdateDelete = results.filter((r) =>
    r.missing.some((m) => m.includes("update") || m.includes("delete"))
  );
  if (missingUpdateDelete.length > 0) {
    gaps.push(`Update/delete operations missing across ${missingUpdateDelete.length} apps`);
  }

  const missingSearch = results.filter((r) =>
    r.missing.some((m) => m.includes("search") || m.includes("find"))
  );
  if (missingSearch.length > 0) {
    gaps.push(`Search/filter tools missing across ${missingSearch.length} apps`);
  }

  return gaps;
}
