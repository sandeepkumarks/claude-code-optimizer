import fs from "node:fs";
import path from "node:path";
import { getDb, SuggestionRecord } from "./db.js";
import {
  SQL_LIST_SUGGESTIONS,
  SQL_LIST_OPEN_SUGGESTIONS,
  SQL_GET_SUGGESTION_BY_ID,
  SQL_MARK_SUGGESTION_APPLIED_AT,
  SQL_MARK_SUGGESTION_REJECTED,
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

  if (suggestion.type === "CLAUDE_MD") {
    writeToClaudeMd(suggestion.content, repoPath);
  }

  db.prepare(SQL_MARK_SUGGESTION_APPLIED_AT).run(id);
}

export function rejectSuggestion(id: number, repoPath = process.cwd()) {
  const db = getDb(repoPath);
  const suggestion = db.prepare<[number, string], SuggestionRecord>(SQL_GET_SUGGESTION_BY_ID).get(id, repoPath);

  if (!suggestion) throw new Error(`Suggestion ${id} not found`);
  if (suggestion.status !== "OPEN") throw new Error(`Suggestion ${id} is already ${suggestion.status}`);

  db.prepare(SQL_MARK_SUGGESTION_REJECTED).run(id);
}

export function isSafeToAutoApply(suggestion: SuggestionRecord): boolean {
  if (suggestion.type !== "CLAUDE_MD") return false;
  return /<!--\s*copt(?::[a-z]+)*:start\s*-->[\s\S]*?<!--\s*copt(?::[a-z]+)*:end\s*-->/.test(suggestion.content);
}

function writeToClaudeMd(content: string, repoPath: string) {
  const claudePath = path.join(repoPath, "CLAUDE.md");
  const existing = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, "utf8") : "";

  const startMatch = content.match(/<!--\s*(copt(?::[a-z]+)*):start\s*-->/);

  if (startMatch) {
    const sectionId = startMatch[1];
    const escapedId = sectionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sectionPattern = new RegExp(
      `<!--\\s*${escapedId}:start\\s*-->[\\s\\S]*?<!--\\s*${escapedId}:end\\s*-->`
    );
    if (sectionPattern.test(existing)) {
      fs.writeFileSync(claudePath, existing.replace(sectionPattern, content.trim()));
    } else {
      const base = existing.trim();
      fs.writeFileSync(claudePath, base ? `${base}\n\n${content.trim()}\n` : `${content.trim()}\n`);
    }
  } else {
    // Non-copt content: always append
    const base = existing.trim();
    fs.writeFileSync(claudePath, base ? `${base}\n\n${content}\n` : `${content}\n`);
  }
}
