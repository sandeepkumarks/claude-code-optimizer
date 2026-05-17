import { getDb } from "./db.js";
import { SQL_FETCH_SESSION_EVENTS, SQL_LIST_APPLIED_SUGGESTIONS, SYNTH_WINDOW_DAYS } from "./queries.js";
import { extractSessionPatterns, RawEvent, SessionPattern } from "./synthesizer.js";

const IMPACT_MIN_SESSIONS = 3;

type SessionMetrics = {
  sessionId: string;
  date: Date;
  preEditReads: number;
  totalReads: number;
  hadEdits: boolean;
  efficiency: number;
};

type ImpactResult = {
  suggestionId: number;
  title: string;
  appliedAt: Date;
  appliedAtEstimated: boolean;
  beforeSessions: number;
  afterSessions: number;
  beforeAvg: number | null;
  afterAvg: number | null;
  pctChange: number | null;
};

type AuditReport = {
  date: string;
  windowDays: number;
  totalSessions: number;
  impacts: ImpactResult[];
  overallEfficiencyBefore: number | null;
  overallEfficiencyAfter: number | null;
};

type AppliedRow = {
  id: number;
  title: string;
  appliedAt: string | null;
  createdAt: string;
};

function toMetrics(pattern: SessionPattern): SessionMetrics {
  const preEditReads = pattern.navigationPath.length;
  const totalReads = pattern.totalReads;
  const efficiency = totalReads > 0 && pattern.hadEdits
    ? pattern.editTargets.length / totalReads
    : 0;

  return {
    sessionId: pattern.sessionId,
    date: pattern.date,
    preEditReads,
    totalReads,
    hadEdits: pattern.hadEdits,
    efficiency,
  };
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeAudit(repoPath = process.cwd()): AuditReport {
  const db = getDb(repoPath);
  const date = new Date().toISOString().slice(0, 10);

  const events = db.prepare<[string], RawEvent>(SQL_FETCH_SESSION_EVENTS).all(repoPath);
  if (events.length === 0) {
    return { date, windowDays: SYNTH_WINDOW_DAYS, totalSessions: 0, impacts: [], overallEfficiencyBefore: null, overallEfficiencyAfter: null };
  }

  const patterns = extractSessionPatterns(events);
  const metrics = patterns
    .filter(p => p.hadEdits)
    .map(toMetrics)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const appliedRows = db.prepare<[string], AppliedRow>(SQL_LIST_APPLIED_SUGGESTIONS).all(repoPath);

  const impacts: ImpactResult[] = appliedRows.map(row => {
    const appliedAtEstimated = row.appliedAt === null;
    const appliedAt = new Date(row.appliedAt ?? row.createdAt);

    const before = metrics.filter(m => m.date < appliedAt);
    const after  = metrics.filter(m => m.date >= appliedAt);

    const beforeAvg = before.length >= IMPACT_MIN_SESSIONS
      ? avg(before.map(m => m.preEditReads))
      : null;
    const afterAvg  = after.length >= IMPACT_MIN_SESSIONS
      ? avg(after.map(m => m.preEditReads))
      : null;

    const pctChange = beforeAvg !== null && afterAvg !== null && beforeAvg > 0
      ? ((afterAvg - beforeAvg) / beforeAvg) * 100
      : null;

    return {
      suggestionId: row.id,
      title: row.title,
      appliedAt,
      appliedAtEstimated,
      beforeSessions: before.length,
      afterSessions: after.length,
      beforeAvg,
      afterAvg,
      pctChange,
    };
  });

  // Overall efficiency: first half vs second half of sessions in the window
  const mid = Math.floor(metrics.length / 2);
  const firstHalf  = metrics.slice(0, mid);
  const secondHalf = metrics.slice(mid);
  const overallEfficiencyBefore = avg(firstHalf.map(m => m.efficiency));
  const overallEfficiencyAfter  = avg(secondHalf.map(m => m.efficiency));

  return {
    date,
    windowDays: SYNTH_WINDOW_DAYS,
    totalSessions: patterns.length,
    impacts,
    overallEfficiencyBefore,
    overallEfficiencyAfter,
  };
}

export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];

  lines.push(`memex audit  ·  ${report.date}`);
  lines.push(`Sessions analyzed: ${report.totalSessions}  (last ${report.windowDays} days)`);

  if (report.totalSessions === 0) {
    lines.push("\nNo sessions recorded yet. Run Claude Code with memex hooks installed.");
    return lines.join("\n");
  }

  lines.push(`Applied optimizations: ${report.impacts.length}`);

  if (report.impacts.length === 0) {
    lines.push("\nNo optimizations applied yet. Run: memex analyze");
    return lines.join("\n");
  }

  lines.push("");

  for (const imp of report.impacts) {
    const dateStr = imp.appliedAt.toISOString().slice(0, 10);
    const estNote = imp.appliedAtEstimated ? " (estimated)" : "";
    const bar = "─".repeat(Math.max(2, 52 - imp.title.length));
    lines.push(`── ${imp.title} ${bar}  Applied ${dateStr}${estNote}`);

    if (imp.beforeAvg !== null && imp.afterAvg !== null && imp.pctChange !== null) {
      const dir = imp.pctChange <= 0 ? "↓" : "↑";
      const absPct = Math.abs(imp.pctChange).toFixed(0);
      const label = imp.pctChange <= 0 ? `${dir} ${absPct}% fewer reads` : `${dir} ${absPct}% more reads`;
      lines.push(`   Pre-edit reads:  ${imp.beforeAvg.toFixed(1)} avg  →  ${imp.afterAvg.toFixed(1)} avg  (${label})`);
      lines.push(`   Based on ${imp.beforeSessions} sessions before, ${imp.afterSessions} sessions after`);
    } else {
      const missing = imp.beforeSessions < IMPACT_MIN_SESSIONS
        ? `only ${imp.beforeSessions} session(s) before`
        : `only ${imp.afterSessions} session(s) after`;
      lines.push(`   Insufficient data — ${missing} this optimization`);
    }

    lines.push("");
  }

  if (report.overallEfficiencyBefore !== null && report.overallEfficiencyAfter !== null) {
    const before = report.overallEfficiencyBefore.toFixed(2);
    const after  = report.overallEfficiencyAfter.toFixed(2);
    const delta = report.overallEfficiencyAfter - report.overallEfficiencyBefore;
    const trend = delta > 0.01 ? "↑ improving" : delta < -0.01 ? "↓ declining" : "→ stable";
    lines.push(`Overall efficiency (edits ÷ reads): ${before} → ${after}  ${trend}`);
  }

  return lines.join("\n");
}
