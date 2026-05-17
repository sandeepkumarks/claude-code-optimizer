import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  SQL_CREATE_SCHEMA,
  SQL_MIGRATE_APPLIED_AT,
  SQL_MIGRATE_DROP_PAYLOAD,
  SQL_INSERT_EVENT,
  SQL_SELECT_EXISTING_SUGGESTION,
  SQL_UPDATE_SUGGESTION_CONTENT,
  SQL_INSERT_SUGGESTION,
} from "./queries.js";

export type EventRecord = {
  id?: number;
  sessionId: string;
  repoPath: string;
  eventType: string;
  toolName?: string | null;
  filePath?: string | null;
  command?: string | null;
  createdAt?: string;
};

export type SuggestionRecord = {
  id?: number;
  repoPath: string;
  type: "CLAUDE_MD" | "SKILL";
  title: string;
  content: string;
  reason: string;
  status?: "OPEN" | "APPLIED" | "REJECTED";
  createdAt?: string;
};

const dbCache = new Map<string, InstanceType<typeof Database>>();

function resolveRepoPath(repoPath: string): string {
  try { return fs.realpathSync(repoPath); } catch { return repoPath; }
}

export function getDb(repoPath = process.cwd()) {
  repoPath = resolveRepoPath(repoPath);

  if (dbCache.has(repoPath)) return dbCache.get(repoPath)!;

  const dir = path.join(repoPath, ".claude", "optimizer");
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(path.join(dir, "optimizer.sqlite"));

  db.exec(SQL_CREATE_SCHEMA);
  try { db.exec(SQL_MIGRATE_APPLIED_AT); } catch { /* column already exists */ }
  try { db.exec(SQL_MIGRATE_DROP_PAYLOAD); } catch { /* column already dropped */ }

  dbCache.set(repoPath, db);
  return db;
}

export function insertEvent(event: EventRecord) {
  event = { ...event, repoPath: resolveRepoPath(event.repoPath) };
  const db = getDb(event.repoPath);
  db.prepare(SQL_INSERT_EVENT).run({
    sessionId: event.sessionId,
    repoPath: event.repoPath,
    eventType: event.eventType,
    toolName: event.toolName ?? null,
    filePath: event.filePath ?? null,
    command: event.command ?? null,
  });
}

export function upsertSuggestion(suggestion: SuggestionRecord) {
  suggestion = { ...suggestion, repoPath: resolveRepoPath(suggestion.repoPath) };
  const db = getDb(suggestion.repoPath);

  const existing = db.prepare<[string, string, string], { id: number; status: string; content: string }>(SQL_SELECT_EXISTING_SUGGESTION).get(suggestion.repoPath, suggestion.type, suggestion.title);

  if (existing) {
    if (existing.status === "REJECTED") return existing.id;
    const isMemexManaged = suggestion.type === "CLAUDE_MD";
    if (existing.status === "APPLIED" && !isMemexManaged) return existing.id;
    const contentChanged = existing.content !== suggestion.content;
    db.prepare(SQL_UPDATE_SUGGESTION_CONTENT).run(suggestion.content, suggestion.reason, existing.id);
    if (existing.status === "APPLIED" && isMemexManaged && contentChanged) {
      db.prepare("UPDATE suggestions SET status = 'OPEN' WHERE id = ?").run(existing.id);
    }
    return existing.id;
  }

  const result = db.prepare(SQL_INSERT_SUGGESTION).run(suggestion);

  return Number(result.lastInsertRowid);
}
