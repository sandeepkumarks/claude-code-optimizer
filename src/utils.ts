import path from "node:path";

const INTERNAL_PATH_SEGMENTS = [
  /[/\\]\.claude[/\\]/,
  /^\.claude[/\\]/,
  /[/\\]memory[/\\]/,
  /\bMEMORY\.md$/,
  /project_philosophy\.md$/,
  /feedback_suggestion_quality\.md$/,
  /[/\\]node_modules[/\\]/,
  /[/\\]dist[/\\]/,
  /[/\\]build[/\\]/,
  /[/\\]\.git[/\\]/,
];

export function isInternalPath(filePath: string): boolean {
  return INTERNAL_PATH_SEGMENTS.some(p => p.test(filePath));
}

// Heuristic file-purpose summaries. Returns a short phrase, not a sentence.
export function inferFileSummary(relPath: string): string {
  const ext = path.extname(relPath);
  const base = path.basename(relPath, ext).toLowerCase();
  const dir = path.dirname(relPath).toLowerCase();

  const exact: Record<string, string> = {
    analyzer:    "analyzes captured events and generates optimization suggestions",
    synthesizer: "synthesizes session patterns into entry-point and navigation guidance",
    db:          "SQLite schema and persistence helpers",
    apply:       "applies approved suggestions to CLAUDE.md",
    cli:         "CLI entry point: init, analyze, suggestions, apply, reject, audit",
    queries:     "SQL queries and threshold constants",
    hook:        "records Claude Code tool events to SQLite",
    init:        "installs Claude Code local hooks for event capture",
    audit:       "computes impact metrics for applied optimizations",
    utils:       "shared utilities",
  };
  if (exact[base]) return exact[base];

  if (base.includes("router") || base.includes("routes")) return `routing definitions`;
  if (base.includes("model"))                               return `data model definitions`;
  if (base.includes("schema"))                              return `data schema definitions`;
  if (base.includes("service"))                             return `${base} business logic`;
  if (base.includes("controller"))                          return `${base} request handlers`;
  if (base.includes("config"))                              return `configuration`;
  if (base.includes("middleware"))                          return `${base} middleware`;
  if (base.includes("util") || base.includes("helper"))     return `shared utilities`;
  if (base.includes("type") || base.includes("interface"))  return `type definitions`;
  if (base.includes("const") || base.includes("constant"))  return `constants`;
  if (base.includes("store") || base.includes("slice"))     return `${base} state management`;
  if (base.includes("test") || base.includes("spec"))       return `tests for ${dir}`;
  if (base === "index") return `module entry point for ${dir || "repo root"}`;
  if (base === "package")  return "project dependencies and scripts";
  if (base === "tsconfig") return "TypeScript configuration";

  return `key module in ${dir || "repo root"}`;
}
