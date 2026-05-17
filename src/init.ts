import fs from "node:fs";
import path from "node:path";

const TRACKED_TOOLS = "Read|Grep|Glob|Edit|MultiEdit|Write|Bash";

export function initRepo(repoPath = process.cwd()): { settingsPath: string; alreadyInstalled: boolean } {
  const claudeDir = path.join(repoPath, ".claude");
  const optimizerDir = path.join(claudeDir, "optimizer");
  fs.mkdirSync(optimizerDir, { recursive: true });

  const settingsPath = path.join(claudeDir, "settings.local.json");

  const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const hookCommand = `node ${path.join(packageRoot, "dist", "hook.js")}`;

  const newHooks = {
    PostToolUse: [
      {
        matcher: TRACKED_TOOLS,
        hooks: [{ type: "command", command: hookCommand }]
      }
    ],
    Stop: [
      {
        hooks: [{ type: "command", command: hookCommand }]
      }
    ],
    SubagentStop: [
      {
        hooks: [{ type: "command", command: hookCommand }]
      }
    ]
  };

  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: newHooks }, null, 2));
    return { settingsPath, alreadyInstalled: false };
  }

  // File exists — check if the optimizer hook is already wired in
  let existing: any = {};
  try {
    existing = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    // Malformed JSON — overwrite
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: newHooks }, null, 2));
    return { settingsPath, alreadyInstalled: false };
  }

  const postToolHooks: any[] = existing?.hooks?.PostToolUse ?? [];
  const alreadyInstalled = postToolHooks.some((entry: any) =>
    entry?.hooks?.some((h: any) => typeof h.command === "string" && h.command.includes("hook.js"))
  );

  if (alreadyInstalled) return { settingsPath, alreadyInstalled: true };

  // Merge our hooks into the existing settings
  existing.hooks = existing.hooks ?? {};
  existing.hooks.PostToolUse = [...(existing.hooks.PostToolUse ?? []), ...newHooks.PostToolUse];
  existing.hooks.Stop = [...(existing.hooks.Stop ?? []), ...newHooks.Stop];
  existing.hooks.SubagentStop = [...(existing.hooks.SubagentStop ?? []), ...newHooks.SubagentStop];

  fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
  return { settingsPath, alreadyInstalled: false };
}
