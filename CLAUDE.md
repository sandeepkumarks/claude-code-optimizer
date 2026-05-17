# copt philosophy

copt is a passive optimization layer for Claude Code.

Primary goal:
silently improve developer experience over time without requiring workflow changes.

The product should:
- reduce unnecessary exploration
- improve repo memory quality
- improve CLAUDE.md signal density
- reduce context waste
- improve Claude effectiveness in large repos

The product should NOT:
- force new workflows
- generate maintenance burden
- require cloud infrastructure
- interrupt developer workflows

Key principle:
optimize silently and incrementally.

Prefer:
- lightweight heuristics
- high-signal memory synthesis
- low-maintenance improvements
- explainable optimizations

Avoid:
- dashboards
- overengineering
- autonomous workflow generation
- excessive artifact creation

<!-- copt:start -->
## Repo navigation (synthesized by copt, 2026-05-16)

### Session entry points
Files Claude consistently reads at the start of sessions:
- `src/analyzer.ts` — 6 sessions, avg position 2.8, led to edits 100% of the time
- `src/apply.ts` — 6 sessions, avg position 4.0, led to edits 100% of the time
- `src/db.ts` — 6 sessions, avg position 4.0, led to edits 100% of the time
- `src/cli.ts` — 5 sessions, avg position 3.8, led to edits 100% of the time
- `src/hook.ts` — 4 sessions, avg position 4.0, led to edits 100% of the time
- `src/queries.ts` — 4 sessions, avg position 5.0, led to edits 100% of the time
- `src/synthesizer.ts` — 4 sessions, avg position 5.0, led to edits 100% of the time

### Navigation patterns
When editing `src/`:
- Start with: `src/apply.ts`, `src/analyzer.ts`, `src/db.ts`, `src/cli.ts`, `src/init.ts`
<!-- copt:end -->

<!-- copt:hotspots:start -->
## Context hotspots worth summarizing

Use this guidance to reduce repeated reads:

- src/cli.ts: CLI entry point: init, analyze, suggestions, apply, reject, audit
- src/analyzer.ts: analyzes captured events and generates optimization suggestions
- src/queries.ts: SQL queries and threshold constants
- src/db.ts: SQLite schema and persistence helpers
- src/apply.ts: applies approved suggestions to CLAUDE.md
- src/synthesizer.ts: synthesizes session patterns into entry-point and navigation guidance
- src/hook.ts: records Claude Code tool events to SQLite
<!-- copt:hotspots:end -->
