import fs from "node:fs";
import path from "node:path";
import { getDb, upsertSuggestion, SuggestionRecord } from "./db.js";
import {
  SQL_MERGED_HOTSPOTS,
  SQL_NOISE_FOLDERS,
  SQL_LAST_SEEN_FILE,
  HOTSPOT_MIN_SESSIONS,
  HOTSPOT_REREAD_MIN_SESSIONS,
  NOISE_MIN_READ_SESSIONS,
  NOISE_MAX_EDIT_RATIO,
  NOISE_MIN_FOLDER_FILES,
  NOISE_MIN_PATHS,
  STALENESS_DAYS,
  MAX_OPEN_SUGGESTIONS,
} from "./queries.js";
import { analyzeEntryPoints } from "./synthesizer.js";
import { applySuggestion, isSafeToAutoApply, listSuggestions } from "./apply.js";
import { isInternalPath, inferFileSummary } from "./utils.js";

type Db = ReturnType<typeof getDb>;
type NoisyFileRow = { filePath: string; readSessions: number; editSessions: number };

export function analyze(repoPath = process.cwd(), autoApply = false) {
  const db = getDb(repoPath);
  const suggestions: number[] = [];

  // Priority order: entry-points > hotspots > stale > noise. Stop once capped.
  suggestions.push(...analyzeEntryPoints(db, repoPath));

  if (suggestions.length < MAX_OPEN_SUGGESTIONS)
    suggestions.push(...analyzeContextHotspots(db, repoPath));

  if (suggestions.length < MAX_OPEN_SUGGESTIONS)
    suggestions.push(...analyzeClaudemdStaleness(repoPath));

  if (suggestions.length < MAX_OPEN_SUGGESTIONS)
    suggestions.push(...analyzeNoiseFolders(db, repoPath));

  if (autoApply) {
    autoApplySafe(suggestions, repoPath);
  }

  return suggestions;
}

type MergedHotspotRow = {
  filePath: string;
  sessionCount: number;
  totalReads: number;
  maxReadsInSession: number;
  rereadSessions: number;
};

function analyzeContextHotspots(db: Db, repoPath: string): number[] {
  const rows = db.prepare<[string], MergedHotspotRow>(SQL_MERGED_HOTSPOTS)
    .all(repoPath)
    .filter(r => !isInternalPath(r.filePath));

  if (rows.length === 0) return [];

  const summaries = rows.map(r => {
    const rel = path.relative(repoPath, r.filePath);
    return `- ${rel}: ${inferFileSummary(rel)}`;
  });

  const content = [
    "## Context hotspots worth summarizing",
    "",
    "Use this guidance to reduce repeated reads:",
    "",
    ...summaries,
  ].join("\n");

  const topSessions = Math.max(...rows.map(r => r.sessionCount));
  const id = upsertSuggestion({
    repoPath,
    type: "CLAUDE_MD",
    title: "Context hotspots worth summarizing",
    content,
    reason: `${rows.length} file(s) read across ${topSessions}+ sessions or re-read ${HOTSPOT_MIN_SESSIONS}+ times in ${HOTSPOT_REREAD_MIN_SESSIONS}+ sessions. Inlining key context reduces cold-start rebuilding.`
  });

  return [id];
}

export function analyzeClaudemdStaleness(repoPath: string): number[] {
  const claudePath = path.join(repoPath, "CLAUDE.md");
  if (!fs.existsSync(claudePath)) return [];

  const raw = fs.readFileSync(claudePath, "utf8");

  // Strip the memex-owned section before scanning for stale references
  const humanContent = raw.replace(/<!--\s*memex:start\s*-->[\s\S]*?<!--\s*memex:end\s*-->/g, "");

  const filePattern = /\b([\w./\-]+\.(ts|js|tsx|jsx|py|go|md|json|yaml|yml|sh))\b/g;
  const candidates = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = filePattern.exec(humanContent)) !== null) {
    const candidate = match[1];
    if (!isInternalPath(candidate)) candidates.add(candidate);
  }

  if (candidates.size === 0) return [];

  const db = getDb(repoPath);
  const stale: string[] = [];

  for (const ref of candidates) {
    const absPath = path.isAbsolute(ref) ? ref : path.join(repoPath, ref);

    if (!fs.existsSync(absPath)) {
      stale.push(`- \`${ref}\` — file not found on disk`);
      continue;
    }

    const row = db.prepare<[string, string], { lastSeen: string | null }>(SQL_LAST_SEEN_FILE).get(repoPath, absPath);
    if (!row?.lastSeen) {
      stale.push(`- \`${ref}\` — never accessed in recorded sessions`);
      continue;
    }

    const lastSeen = new Date(row.lastSeen);
    const daysSince = Math.floor((Date.now() - lastSeen.getTime()) / 86_400_000);
    if (daysSince > STALENESS_DAYS) {
      stale.push(`- \`${ref}\` — last accessed ${daysSince} days ago (${lastSeen.toISOString().slice(0, 10)})`);
    }
  }

  if (stale.length === 0) return [];

  const content = [
    "## CLAUDE.md report — potentially stale references",
    "",
    "These file paths in CLAUDE.md haven't been accessed recently or no longer exist:",
    "",
    ...stale,
    "",
    "Consider removing or updating these references to keep CLAUDE.md accurate.",
    "(This is a warning only — no content has been changed.)",
  ].join("\n");

  const id = upsertSuggestion({
    repoPath,
    type: "CLAUDE_MD",
    title: "CLAUDE.md report — potentially stale references",
    content,
    reason: `${stale.length} file reference(s) in CLAUDE.md appear stale or missing.`
  });

  return [id];
}

function aggregateToFolders(
  rows: NoisyFileRow[],
  repoPath: string
): Array<{ label: string; readSessions: number; isFolder: boolean }> {
  const byDir = new Map<string, NoisyFileRow[]>();
  for (const row of rows) {
    const dir = path.dirname(row.filePath);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(row);
  }

  const result: Array<{ label: string; readSessions: number; isFolder: boolean }> = [];
  for (const [dir, siblings] of byDir) {
    if (siblings.length >= NOISE_MIN_FOLDER_FILES) {
      const maxRead = Math.max(...siblings.map(s => s.readSessions));
      const rel = path.relative(repoPath, dir);
      result.push({ label: rel === "." ? "./" : `${rel}/`, readSessions: maxRead, isFolder: true });
    } else {
      for (const row of siblings) {
        result.push({ label: path.relative(repoPath, row.filePath), readSessions: row.readSessions, isFolder: false });
      }
    }
  }
  return result.sort((a, b) => b.readSessions - a.readSessions);
}

function analyzeNoiseFolders(db: Db, repoPath: string): number[] {
  const rows = db.prepare<[string], NoisyFileRow>(SQL_NOISE_FOLDERS)
    .all(repoPath)
    .filter(r => !isInternalPath(r.filePath));

  if (rows.length === 0) return [];

  const paths = aggregateToFolders(rows, repoPath);
  if (paths.length < NOISE_MIN_PATHS) return [];

  const lines = paths.map(p => {
    const sessions = `${p.readSessions} session${p.readSessions === 1 ? "" : "s"}`;
    return `- \`${p.label}\` — explored in ${sessions}, never edited`;
  });

  const content = [
    "## Repo noise: paths to skip during exploration",
    "",
    "These paths are read often but almost never edited. Skip them during initial navigation unless the task explicitly targets them:",
    "",
    ...lines,
  ].join("\n");

  const id = upsertSuggestion({
    repoPath,
    type: "CLAUDE_MD",
    title: "Suppress noise: de-prioritize frequently-explored, never-edited paths",
    content,
    reason: `${paths.length} path(s) read in ${NOISE_MIN_READ_SESSIONS}+ sessions but edited in fewer than ${Math.round(NOISE_MAX_EDIT_RATIO * 100)}% of those sessions.`
  });

  return [id];
}

function autoApplySafe(suggestionIds: number[], repoPath: string) {
  const suggestions = listSuggestions(repoPath).filter((s: SuggestionRecord) =>
    suggestionIds.includes(s.id!) && s.status !== "REJECTED"
  );

  const db = getDb(repoPath);
  for (const s of suggestions) {
    if (!isSafeToAutoApply(s)) continue;
    // Reset to OPEN so applySuggestion can proceed, then it marks APPLIED
    if (s.status === "APPLIED") {
      db.prepare("UPDATE suggestions SET status = 'OPEN', applied_at = NULL WHERE id = ?").run(s.id);
      s.status = "OPEN";
    }
    applySuggestion(s.id!, repoPath);
  }
}
