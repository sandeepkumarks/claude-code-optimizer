# memex — Claude Code Optimizer

A passive, local-first optimization layer for Claude Code. memex silently learns how Claude navigates your repo and incrementally improves `CLAUDE.md` — reducing unnecessary exploration and improving Claude's effectiveness over time.

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
memex init
```

Installs Claude Code hooks into `.claude/settings.local.json`. If a settings file already exists, hooks are merged in without overwriting your existing config.

Data is stored locally at `.claude/optimizer/optimizer.sqlite`.

## Commands

### `memex analyze`

Analyze captured sessions and generate CLAUDE.md suggestions.

```bash
memex analyze
```

Add `--auto` to silently apply safe optimizations without approval. Auto mode only writes to the `<!-- memex:start/end -->` boundary in CLAUDE.md — human-authored content is never touched.

```bash
memex analyze --auto
```

### `memex suggestions`

List all open suggestions with proposed content and reasoning.

```bash
memex suggestions
```

### `memex apply <id>`

Apply a suggestion — writes synthesized content to CLAUDE.md.

```bash
memex apply 3
```

### `memex reject <id>`

Dismiss a suggestion. Rejected suggestions are not re-generated.

```bash
memex reject 3
```

### `memex audit`

Show whether applied optimizations actually reduced Claude's exploration overhead. Compares pre-edit read counts before and after each optimization was applied.

```bash
memex audit
```

Example output:

```
memex audit  ·  2026-05-16
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

**Session synthesis** — At session end, memex extracts the navigation path (files read before the first edit) and edit targets. This becomes the raw material for synthesis.

**Scoring** — Files are scored by: how early they appear in sessions, how often they correlate with edits, and recency. Low-confidence files are filtered out.

**CLAUDE.md section** — The synthesized navigation hints are written inside `<!-- memex:start -->` / `<!-- memex:end -->` markers. This section is owned by memex and refreshed on each run. Everything outside the markers is yours.

**Impact tracking** — Each applied suggestion records a timestamp. The audit command splits your session history at that timestamp and compares exploration depth before vs after.

## What memex does NOT do

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
