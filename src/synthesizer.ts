import path from "node:path";
import { getDb, upsertSuggestion } from "./db.js";
import { isInternalPath } from "./utils.js";
import {
  SQL_FETCH_SESSION_EVENTS,
  SYNTH_WINDOW_DAYS,
  SYNTH_MIN_SESSION_COUNT,
  SYNTH_MIN_EDIT_CORR,
  SYNTH_MAX_ENTRY_POINTS,
  SYNTH_MAX_TASK_PATTERNS,
  SYNTH_NAV_WINDOW,
} from "./queries.js";

type Db = ReturnType<typeof getDb>;

export type RawEvent = {
  sessionId: string;
  toolName: string;
  filePath: string | null;
  command: string | null;
  createdAt: string;
};

export type SessionPattern = {
  sessionId: string;
  date: Date;
  navigationPath: string[];
  editTargets: string[];
  totalReads: number;
  hadEdits: boolean;
};

type FileScore = {
  filePath: string;
  score: number;
  sessionCount: number;
  avgRank: number;
  editCorrelation: number;
  daysSinceLastSeen: number;
};

type TaskPattern = {
  area: string;
  navFiles: string[];
  sessionCount: number;
};

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);

export function extractSessionPatterns(events: RawEvent[]): SessionPattern[] {
  const bySession = new Map<string, RawEvent[]>();
  for (const e of events) {
    if (!bySession.has(e.sessionId)) bySession.set(e.sessionId, []);
    bySession.get(e.sessionId)!.push(e);
  }

  const patterns: SessionPattern[] = [];

  for (const [sessionId, sessionEvents] of bySession) {
    const firstEditIdx = sessionEvents.findIndex(e => EDIT_TOOLS.has(e.toolName));
    const hadEdits = firstEditIdx !== -1;

    const preEditEvents = hadEdits ? sessionEvents.slice(0, firstEditIdx) : sessionEvents;
    const navEvents = preEditEvents.slice(0, SYNTH_NAV_WINDOW);

    const navigationPath = navEvents
      .filter(e => e.toolName === "Read" && e.filePath && !isInternalPath(e.filePath))
      .map(e => e.filePath!)
      // dedupe while preserving first-occurrence order
      .filter((f, i, arr) => arr.indexOf(f) === i);

    const editTargets = hadEdits
      ? sessionEvents
          .filter(e => EDIT_TOOLS.has(e.toolName) && e.filePath && !isInternalPath(e.filePath))
          .map(e => e.filePath!)
          .filter((f, i, arr) => arr.indexOf(f) === i)
      : [];

    const totalReads = sessionEvents.filter(e => e.toolName === "Read").length;

    // Discard pure-noise sessions: no edits AND fewer than 3 reads
    if (!hadEdits && totalReads < 3) continue;

    patterns.push({
      sessionId,
      date: new Date(sessionEvents[0].createdAt),
      navigationPath,
      editTargets,
      totalReads,
      hadEdits,
    });
  }

  return patterns;
}

function scoreFiles(patterns: SessionPattern[]): FileScore[] {
  const now = Date.now();

  // file → sessions it appeared in navigationPath
  const fileSessionRanks = new Map<string, { ranks: number[]; editSessions: number; lastSeen: Date }>();

  for (const pattern of patterns) {
    for (let i = 0; i < pattern.navigationPath.length; i++) {
      const file = pattern.navigationPath[i];
      if (!fileSessionRanks.has(file)) {
        fileSessionRanks.set(file, { ranks: [], editSessions: 0, lastSeen: pattern.date });
      }
      const entry = fileSessionRanks.get(file)!;
      entry.ranks.push(i + 1); // 1-based rank
      if (pattern.hadEdits) entry.editSessions++;
      if (pattern.date > entry.lastSeen) entry.lastSeen = pattern.date;
    }
  }

  const scores: FileScore[] = [];

  for (const [filePath, data] of fileSessionRanks) {
    const sessionCount = data.ranks.length;
    const avgRank = data.ranks.reduce((a, b) => a + b, 0) / sessionCount;
    const editCorrelation = sessionCount > 0 ? data.editSessions / sessionCount : 0;
    const daysSinceLastSeen = Math.floor((now - data.lastSeen.getTime()) / 86_400_000);
    const recencyFactor = Math.max(0, 1 - daysSinceLastSeen / SYNTH_WINDOW_DAYS);

    const score = sessionCount * (1 / avgRank) * editCorrelation * recencyFactor;

    scores.push({ filePath, score, sessionCount, avgRank, editCorrelation, daysSinceLastSeen });
  }

  return scores
    .filter(s => s.sessionCount >= SYNTH_MIN_SESSION_COUNT && s.editCorrelation >= SYNTH_MIN_EDIT_CORR)
    .sort((a, b) => b.score - a.score)
    .slice(0, SYNTH_MAX_ENTRY_POINTS);
}

function extractTaskPatterns(patterns: SessionPattern[], repoPath: string): TaskPattern[] {
  // Group sessions by top-level edit area (directory of first edit target)
  const areaMap = new Map<string, Set<string>[]>();

  for (const pattern of patterns) {
    if (!pattern.hadEdits || pattern.navigationPath.length === 0) continue;

    for (const target of pattern.editTargets) {
      const rel = path.relative(repoPath, target);
      const area = path.dirname(rel) === "." ? rel : path.dirname(rel);

      if (!areaMap.has(area)) areaMap.set(area, []);
      areaMap.get(area)!.push(new Set(pattern.navigationPath));
    }
  }

  const taskPatterns: TaskPattern[] = [];

  for (const [area, navSets] of areaMap) {
    if (navSets.length < SYNTH_MIN_SESSION_COUNT) continue;

    // Find nav files that appear in ≥ half the sessions for this area
    const counts = new Map<string, number>();
    for (const set of navSets) {
      for (const f of set) counts.set(f, (counts.get(f) ?? 0) + 1);
    }

    const threshold = Math.ceil(navSets.length / 2);
    const navFiles = [...counts.entries()]
      .filter(([, c]) => c >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([f]) => f);

    if (navFiles.length > 0) {
      taskPatterns.push({ area, navFiles, sessionCount: navSets.length });
    }
  }

  return taskPatterns
    .sort((a, b) => b.sessionCount - a.sessionCount)
    .slice(0, SYNTH_MAX_TASK_PATTERNS);
}

function formatMemexSection(
  entryPoints: FileScore[],
  taskPatterns: TaskPattern[],
  repoPath: string,
  date: string
): string {
  const lines: string[] = [
    `## Repo navigation (synthesized by memex, ${date})`,
  ];

  if (entryPoints.length > 0) {
    lines.push("", "### Session entry points");
    lines.push("Files Claude consistently reads at the start of sessions:");
    for (const f of entryPoints) {
      const rel = path.relative(repoPath, f.filePath);
      const pct = Math.round(f.editCorrelation * 100);
      lines.push(`- \`${rel}\` — ${f.sessionCount} sessions, avg position ${f.avgRank.toFixed(1)}, led to edits ${pct}% of the time`);
    }
  }

  if (taskPatterns.length > 0) {
    lines.push("", "### Navigation patterns");
    for (const tp of taskPatterns) {
      lines.push(`When editing \`${tp.area}/\`:`);
      lines.push(`- Start with: ${tp.navFiles.map(f => `\`${path.relative(repoPath, f)}\``).join(", ")}`);
    }
  }

  return lines.join("\n");
}

export function analyzeEntryPoints(db: Db, repoPath: string): number[] {
  const events = db.prepare<[string], RawEvent>(SQL_FETCH_SESSION_EVENTS).all(repoPath);
  if (events.length === 0) return [];

  const patterns = extractSessionPatterns(events);
  if (patterns.length < SYNTH_MIN_SESSION_COUNT) return [];

  const entryPoints = scoreFiles(patterns);
  const taskPatterns = extractTaskPatterns(patterns, repoPath);

  if (entryPoints.length === 0 && taskPatterns.length === 0) return [];

  const date = new Date().toISOString().slice(0, 10);
  const content = formatMemexSection(entryPoints, taskPatterns, repoPath, date);

  const id = upsertSuggestion({
    repoPath,
    type: "CLAUDE_MD",
    title: "Session navigation entry points (memex-synthesized)",
    content,
    reason: `Synthesized from ${patterns.length} sessions over the last ${SYNTH_WINDOW_DAYS} days. ${entryPoints.length} entry point(s), ${taskPatterns.length} task pattern(s) found.`,
  });

  return [id];
}

