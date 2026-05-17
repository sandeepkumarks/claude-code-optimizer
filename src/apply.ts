import fs from "node:fs";
import path from "node:path";
import { getDb, SuggestionRecord } from "./db.js";
import {
  SQL_LIST_SUGGESTIONS,
  SQL_LIST_OPEN_SUGGESTIONS,
  SQL_GET_SUGGESTION_BY_ID,
  SQL_MARK_SUGGESTION_APPLIED_AT,
  SQL_MARK_SUGGESTION_REJECTED,
  SQL_LIST_APPLIED_CLAUDE_MD,
} from "./queries.js";

export function listSuggestions(repoPath = process.cwd()): SuggestionRecord[] {
  const db = getDb(repoPath);
  return db.prepare<[string], SuggestionRecord>(SQL_LIST_SUGGESTIONS).all(repoPath);
}

export function listOpenSuggestions(repoPath = process.cwd()): SuggestionRecord[] {
  const db = getDb(repoPath);
  return db.prepare<[string], SuggestionRecord>(SQL_LIST_OPEN_SUGGESTIONS).all(repoPath);
}

export function applySuggestion(id: number, repoPath = process.cwd()) {
  const db = getDb(repoPath);
  const suggestion = db.prepare<[number, string], SuggestionRecord>(SQL_GET_SUGGESTION_BY_ID).get(id, repoPath);

  if (!suggestion) throw new Error(`Suggestion ${id} not found`);
  if (suggestion.status !== "OPEN") throw new Error(`Suggestion ${id} is already ${suggestion.status}`);

  db.prepare(SQL_MARK_SUGGESTION_APPLIED_AT).run(id);

  if (suggestion.type === "CLAUDE_MD") {
    const applied = db.prepare<[string], SuggestionRecord>(SQL_LIST_APPLIED_CLAUDE_MD).all(repoPath);
    writeToClaudeMd(applied, repoPath);
  }
}

export function rejectSuggestion(id: number, repoPath = process.cwd()) {
  const db = getDb(repoPath);
  const suggestion = db.prepare<[number, string], SuggestionRecord>(SQL_GET_SUGGESTION_BY_ID).get(id, repoPath);

  if (!suggestion) throw new Error(`Suggestion ${id} not found`);
  if (suggestion.status !== "OPEN") throw new Error(`Suggestion ${id} is already ${suggestion.status}`);

  db.prepare(SQL_MARK_SUGGESTION_REJECTED).run(id);
}

export function isSafeToAutoApply(suggestion: SuggestionRecord): boolean {
  return suggestion.type === "CLAUDE_MD";
}

const MEMEX_SECTION_ORDER = [
  "Session navigation entry points (memex-synthesized)",
  "Context hotspots worth summarizing",
  "CLAUDE.md report — potentially stale references",
  "Suppress noise: de-prioritize frequently-explored, never-edited paths",
];

const OUTER_BLOCK = /<!--\s*memex:start\s*-->[\s\S]*?<!--\s*memex:end\s*-->/;
const ORPHAN_SUBSECTIONS = /<!--\s*memex:[a-z]+(?::[a-z]+)*:start\s*-->[\s\S]*?<!--\s*memex:[a-z]+(?::[a-z]+)*:end\s*-->/g;

function writeToClaudeMd(suggestions: SuggestionRecord[], repoPath: string) {
  const claudePath = path.join(repoPath, "CLAUDE.md");
  const raw = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, "utf8") : "";

  const sorted = [...suggestions].sort((a, b) => {
    const ai = MEMEX_SECTION_ORDER.indexOf(a.title);
    const bi = MEMEX_SECTION_ORDER.indexOf(b.title);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const inner = sorted.map(s => s.content.trim()).join("\n\n");
  const block = `<!-- memex:start -->\n${inner}\n<!-- memex:end -->`;

  // Strip any orphaned sub-section markers (legacy multi-block format)
  const cleaned = raw.replace(ORPHAN_SUBSECTIONS, "").replace(/\n{3,}/g, "\n\n").trim();

  const updated = OUTER_BLOCK.test(cleaned)
    ? cleaned.replace(OUTER_BLOCK, block)
    : cleaned ? `${cleaned}\n\n${block}\n` : `${block}\n`;

  fs.writeFileSync(claudePath, updated);
}
