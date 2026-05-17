// ── Schema ────────────────────────────────────────────────────────────────────

export const SQL_CREATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    event_type TEXT NOT NULL,
    tool_name TEXT,
    file_path TEXT,
    command TEXT,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_path TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_events_repo_file    ON events(repo_path, file_path);
  CREATE INDEX IF NOT EXISTS idx_events_repo_session ON events(repo_path, session_id);
  CREATE INDEX IF NOT EXISTS idx_events_repo_tool    ON events(repo_path, tool_name);
  CREATE INDEX IF NOT EXISTS idx_suggestions_repo    ON suggestions(repo_path, status);
`;

// ── Events ────────────────────────────────────────────────────────────────────

export const SQL_INSERT_EVENT = `
  INSERT INTO events(session_id, repo_path, event_type, tool_name, file_path, command)
  VALUES (@sessionId, @repoPath, @eventType, @toolName, @filePath, @command)
`;

// ── Suggestions ───────────────────────────────────────────────────────────────

export const SQL_SELECT_EXISTING_SUGGESTION = `
  SELECT id, status FROM suggestions
  WHERE repo_path = ? AND type = ? AND title = ?
  ORDER BY id DESC
  LIMIT 1
`;

export const SQL_UPDATE_SUGGESTION_CONTENT = `
  UPDATE suggestions
  SET content = ?, reason = ?
  WHERE id = ?
`;

export const SQL_INSERT_SUGGESTION = `
  INSERT INTO suggestions(repo_path, type, title, content, reason)
  VALUES (@repoPath, @type, @title, @content, @reason)
`;

export const SQL_LIST_SUGGESTIONS = `
  SELECT id, type, title, content, reason, status, created_at as createdAt
  FROM suggestions
  WHERE repo_path = ?
  ORDER BY id DESC
`;

export const SQL_LIST_OPEN_SUGGESTIONS = `
  SELECT id, type, title, content, reason, status, created_at as createdAt
  FROM suggestions
  WHERE repo_path = ? AND status = 'OPEN'
  ORDER BY id DESC
`;

export const SQL_GET_SUGGESTION_BY_ID = `
  SELECT id, type, title, content, reason, status
  FROM suggestions
  WHERE id = ? AND repo_path = ?
`;

export const SQL_MARK_SUGGESTION_APPLIED_AT = `
  UPDATE suggestions SET status = 'APPLIED', applied_at = CURRENT_TIMESTAMP WHERE id = ?
`;

export const SQL_MARK_SUGGESTION_REJECTED = `
  UPDATE suggestions SET status = 'REJECTED' WHERE id = ?
`;

export const SQL_MIGRATE_APPLIED_AT = `
  ALTER TABLE suggestions ADD COLUMN applied_at TEXT
`;

export const SQL_MIGRATE_DROP_PAYLOAD = `
  ALTER TABLE events DROP COLUMN payload
`;

export const SQL_LIST_APPLIED_SUGGESTIONS = `
  SELECT id, title, applied_at as appliedAt, created_at as createdAt
  FROM suggestions
  WHERE repo_path = ? AND status = 'APPLIED'
  ORDER BY COALESCE(applied_at, created_at) ASC
`;

// ── Synthesizer thresholds ────────────────────────────────────────────────────

export const SYNTH_WINDOW_DAYS       = 30;
export const SYNTH_MIN_SESSION_COUNT = 3;  // raised from 2: require 3+ sessions for entry points / task patterns
export const SYNTH_MIN_EDIT_CORR     = 0.5;
export const SYNTH_MAX_ENTRY_POINTS  = 7;
export const SYNTH_MAX_TASK_PATTERNS = 3;
export const SYNTH_NAV_WINDOW        = 10;
export const STALENESS_DAYS          = 30;
export const SESSION_REREAD_MIN      = 3;
export const SESSION_REREAD_LIMIT    = 5;
export const HOTSPOT_MIN_SESSIONS    = 3;
export const HOTSPOT_LIMIT           = 7;
export const HOTSPOT_REREAD_MIN_SESSIONS = 2; // min sessions where a file is read SESSION_REREAD_MIN+ times
export const MAX_OPEN_SUGGESTIONS    = 3;

// ── Noise-suppression thresholds ──────────────────────────────────────────────

export const NOISE_MIN_READ_SESSIONS = 3;   // file must be read in ≥3 distinct sessions
export const NOISE_MAX_EDIT_RATIO    = 0.2; // < 20% of those sessions may have an edit
export const NOISE_MIN_FOLDER_FILES  = 2;   // promote to folder-level when ≥2 siblings qualify
export const NOISE_MIN_PATHS         = 2;   // skip suggestion if fewer than 2 paths detected

export const SQL_NOISE_FOLDERS = `
  SELECT
    file_path AS filePath,
    COUNT(DISTINCT CASE WHEN tool_name = 'Read'
      THEN session_id END)                          AS readSessions,
    COUNT(DISTINCT CASE WHEN tool_name IN ('Edit','MultiEdit','Write')
      THEN session_id END)                          AS editSessions
  FROM events
  WHERE repo_path = ?
    AND file_path IS NOT NULL
    AND tool_name IN ('Read','Edit','MultiEdit','Write')
    AND created_at >= datetime('now', '-${SYNTH_WINDOW_DAYS} days')
  GROUP BY file_path
  HAVING readSessions >= ${NOISE_MIN_READ_SESSIONS}
    AND CAST(editSessions AS REAL) / readSessions < ${NOISE_MAX_EDIT_RATIO}
  ORDER BY readSessions DESC
`;

// ── Synthesizer queries ───────────────────────────────────────────────────────

export const SQL_FETCH_SESSION_EVENTS = `
  SELECT session_id as sessionId, tool_name as toolName,
         file_path as filePath, command, created_at as createdAt
  FROM events
  WHERE repo_path = ?
    AND created_at >= datetime('now', '-${SYNTH_WINDOW_DAYS} days')
    AND tool_name IN ('Read', 'Edit', 'MultiEdit', 'Write', 'Bash')
  ORDER BY session_id, created_at
`;

export const SQL_FETCH_SINGLE_SESSION_EVENTS = `
  SELECT session_id as sessionId, tool_name as toolName,
         file_path as filePath, command, created_at as createdAt
  FROM events
  WHERE repo_path = ? AND session_id = ?
    AND tool_name IN ('Read', 'Edit', 'MultiEdit', 'Write', 'Bash')
  ORDER BY created_at
`;

export const SQL_LAST_SEEN_FILE = `
  SELECT MAX(created_at) as lastSeen
  FROM events
  WHERE repo_path = ? AND tool_name = 'Read' AND file_path = ?
`;

// ── Session re-reads ──────────────────────────────────────────────────────────

// Merged hotspot query: qualifies if file appears in 3+ sessions OR is re-read 3+ times in 2+ sessions
export const SQL_MERGED_HOTSPOTS = `
  SELECT
    file_path                                                        AS filePath,
    COUNT(DISTINCT session_id)                                       AS sessionCount,
    COUNT(*)                                                         AS totalReads,
    MAX(reads_per_session)                                           AS maxReadsInSession,
    SUM(CASE WHEN reads_per_session >= ${SESSION_REREAD_MIN} THEN 1 ELSE 0 END) AS rereadSessions
  FROM (
    SELECT file_path, session_id, COUNT(*) AS reads_per_session
    FROM events
    WHERE repo_path = ?
      AND tool_name = 'Read'
      AND file_path IS NOT NULL
      AND created_at >= datetime('now', '-${SYNTH_WINDOW_DAYS} days')
    GROUP BY file_path, session_id
  )
  GROUP BY file_path
  HAVING sessionCount >= ${HOTSPOT_MIN_SESSIONS}
      OR rereadSessions >= ${HOTSPOT_REREAD_MIN_SESSIONS}
  ORDER BY (sessionCount * 2 + maxReadsInSession) DESC
  LIMIT ${HOTSPOT_LIMIT}
`;
