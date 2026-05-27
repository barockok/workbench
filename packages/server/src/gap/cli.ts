import { analyzeGaps, AnalysisReport } from "./analyzer";

function formatMarkdown(report: AnalysisReport): string {
  const lines: string[] = [];

  lines.push("# Workbench Gap Analysis");
  lines.push("");
  lines.push(
    `**Generated:** ${new Date().toISOString().split("T")[0]} | **Coverage:** ${report.overallCoverage}% (${report.totalCurrent}/${report.totalTarget})`
  );
  lines.push("");

  lines.push("## Coverage by App");
  lines.push("");
  lines.push("| App | Current | Target | Coverage | Missing Tools |");
  lines.push("|-----|---------|--------|----------|---------------|");

  for (const r of report.results) {
    const missing = r.missing.length > 0 ? r.missing.join(", ") : "—";
    lines.push(
      `| ${r.app} | ${r.current} | ${r.target} | ${r.coverage}% | ${missing} |`
    );
  }

  lines.push("");
  lines.push("## Key Gaps");
  lines.push("");
  for (const gap of report.keyGaps) {
    lines.push(`- ${gap}`);
  }

  lines.push("");
  lines.push("## Next Plugins");
  lines.push("");
  for (const p of report.nextPlugins) {
    lines.push(`- **${p.app}**: ${p.categories.join(", ")}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("*Run `npm run gap` to regenerate.*");

  return lines.join("\n");
}

function formatJson(report: AnalysisReport): string {
  return JSON.stringify(report, null, 2);
}

function formatTerminal(report: AnalysisReport): string {
  const lines: string[] = [];

  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║           WORKBENCH GAP ANALYSIS                             ║");
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");
  lines.push(
    `Overall: ${report.totalCurrent}/${report.totalTarget} tools (${report.overallCoverage}% coverage)`
  );
  lines.push("");

  for (const r of report.results) {
    const bar = "█".repeat(r.coverage / 5).padEnd(20, "░");
    lines.push(`${r.app.padEnd(22)} ${bar} ${r.coverage}%`);
  }

  lines.push("");
  lines.push("Key gaps:");
  for (const gap of report.keyGaps) {
    lines.push(`  • ${gap}`);
  }

  return lines.join("\n");
}

async function main() {
  const format = process.argv[2] || "terminal";
  const report = await analyzeGaps();

  switch (format) {
    case "markdown":
    case "md":
      console.log(formatMarkdown(report));
      break;
    case "json":
      console.log(formatJson(report));
      break;
    case "terminal":
    default:
      console.log(formatTerminal(report));
      break;
  }
}

main().catch((err) => {
  console.error("Gap analysis failed:", err);
  process.exit(1);
});
