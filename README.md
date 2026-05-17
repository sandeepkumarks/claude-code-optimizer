# copt — Claude Code Optimizer

A passive, local-first optimization layer for Claude Code. copt silently learns how Claude navigates your repo and incrementally improves `CLAUDE.md` — reducing unnecessary exploration and improving Claude's effectiveness over time.

No cloud infrastructure. No new workflows. No maintenance burden.

## Philosophy

- **Silent by default** — hooks capture events in the background without interrupting Claude Code
- **High-signal synthesis** — learns session navigation patterns, not just raw file counts
- **Human-controlled** — all CLAUDE.md changes require your approval (or opt into auto mode)
- **Trustworthy** — audit command proves optimizations actually helped

## Install

```bash
npm install
npm run build
npm link
```

## Setup

From your target repo:

```bash
claude-opt init
```

Installs Claude Code hooks into `.claude/settings.local.json`. If a settings file already exists, hooks are merged in without overwriting your existing config.

Data is stored locally at `.claude/optimizer/optimizer.sqlite`.

## Commands

### `claude-opt analyze`

Analyze captured sessions and generate CLAUDE.md suggestions.

```bash
claude-opt analyze
```

Add `--auto` to silently apply safe optimizations without approval. Auto mode only writes to the `<!-- copt:start/end -->` boundary in CLAUDE.md — human-authored content is never touched.

```bash
claude-opt analyze --auto
```

### `claude-opt suggestions`

List all open suggestions with proposed content and reasoning.

```bash
claude-opt suggestions
```

### `claude-opt apply <id>`

Apply a suggestion — writes synthesized content to CLAUDE.md.

```bash
claude-opt apply 3
```

### `claude-opt reject <id>`

Dismiss a suggestion. Rejected suggestions are not re-generated.

```bash
claude-opt reject 3
```

### `claude-opt audit`

Show whether applied optimizations actually reduced Claude's exploration overhead. Compares pre-edit read counts before and after each optimization was applied.

```bash
claude-opt audit
```

Example output:

```
copt audit  ·  2026-05-16
Sessions analyzed: 12  (last 30 days)
Applied optimizations: 2

── Session navigation entry points ──────────────────  Applied 2026-05-01
   Pre-edit reads:  14.2 avg  →  8.1 avg  (↓ 43% fewer reads)
   Based on 5 sessions before, 7 sessions after

── Key context: frequently re-read files ────────────  Applied 2026-04-28
   Insufficient data — only 2 session(s) after this optimization

Overall efficiency (edits ÷ reads): 0.18 → 0.31  ↑ improving
```

## How it works

**Event capture** — A PostToolUse hook fires after every Read, Edit, Write, Grep, Glob, and Bash call. A Stop hook fires when each session ends. Events are stored in a local SQLite database.

**Session synthesis** — At session end, copt extracts the navigation path (files read before the first edit) and edit targets. This becomes the raw material for synthesis.

**Scoring** — Files are scored by: how early they appear in sessions, how often they correlate with edits, and recency. Low-confidence files are filtered out.

**CLAUDE.md section** — The synthesized navigation hints are written inside `<!-- copt:start -->` / `<!-- copt:end -->` markers. This section is owned by copt and refreshed on each run. Everything outside the markers is yours.

**Impact tracking** — Each applied suggestion records a timestamp. The audit command splits your session history at that timestamp and compares exploration depth before vs after.

## What copt does NOT do

- Generate slash commands or skills
- Auto-remove human-authored CLAUDE.md content
- Require cloud infrastructure or accounts
- Interrupt Claude Code sessions
- Produce dashboards or persistent reports

## Data

All data stays local:

```
.claude/
  optimizer/
    optimizer.sqlite    # events + suggestions
  settings.local.json   # hook configuration
```

Add `.claude/optimizer/` to `.gitignore` if you don't want session data committed.
