#!/usr/bin/env node
import { insertEvent } from "./db.js";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => data += chunk);
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function getRepoPath(input: any): string {
  return input.cwd || input.workspace?.current_dir || process.cwd();
}

function getSessionId(input: any): string {
  return input.session_id || input.sessionId || "unknown-session";
}

function extractFilePath(input: any): string | null {
  const toolInput = input.tool_input || {};
  return toolInput.file_path || toolInput.path || toolInput.notebook_path || null;
}

function extractCommand(input: any): string | null {
  const toolInput = input.tool_input || {};
  return toolInput.command || toolInput.pattern || null;
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) return;

  const input = JSON.parse(raw);

  insertEvent({
    sessionId: getSessionId(input),
    repoPath: getRepoPath(input),
    eventType: input.hook_event_name || input.hook_event || input.event || "Unknown",
    toolName: input.tool_name || input.toolName || null,
    filePath: extractFilePath(input),
    command: extractCommand(input),
  });

  process.exit(0);
}

main().catch(err => {
  console.error("[memex hook error]", err);
  process.exit(0);
});
