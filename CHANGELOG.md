# @martian-engineering/lossless-claw

## 0.3.0

### Minor Changes

- f1dfa5c: Catch up the release notes for work merged after `0.2.8`.

  This release adds Anthropic OAuth setup-token support in the TUI, resolves
  SecretRef-backed auth-profile credentials and provider-level custom provider
  configuration during summarization, and formats LCM tool timestamps in the local
  timezone instead of UTC.

### Active Context Management (Fork)

#### Changed

- **lcm_checkpoint restore v2** — Restore is now smart about what to keep. Summaries are restored (accumulated knowledge), but stale pointers and messages are dropped (conversation-scoped, likely expired). Scratchpad is merged (checkpoint's content appended as a "Restored" section, never overwrites current). Includes time-gap reporting and an orientation message with restore statistics.
- **lcm_budget** — Now uses configurable `contextWindow` setting instead of hardcoded 200k assumption.
- **Plugin config** — Added `contextWindow` setting (integer, minimum 10000) to `openclaw.plugin.json` schema and UI hints.

#### Added

- **Suggested AGENTS.md instructions** (`docs/suggested-agents-instructions.md`) — Battle-tested behavioral rules for teaching agents to manage their own context window. Covers hygiene workflows, progressive discovery, post-compaction recovery, reading desk pattern for large documents, pointer lifecycle, and checkpoint strategy.

**10 new tools:**

- **lcm_collapse** — Collapse conversation content into lightweight expandable pointers (~20 tokens each). Supports three modes: collapse (default, creates pointer), remove (permanently delete), replace (swap with custom text). Targets: `last_tool`, `last_tool:ToolName`, `messages:N`, `range:start-end`, `ref:§003`, `map` (show context ref map).
- **lcm_expand_active** — Restore previously collapsed pointers back to full content in the context window.
- **lcm_scratchpad** — Working memory scratchpad placed in the high-attention zone (end of context, before recent messages). Supports read, write, append, and replace_section operations. Survives compaction.
- **lcm_tidy** — One-command context hygiene. Collapses stale tool results (or all old messages) in bulk, preserving recent turns. Configurable with `keepRecentTurns`, `target` (tool_results or all), and `dryRun` mode.
- **lcm_promote** — Move insights from any context item (pointer, summary, or context ref) into the scratchpad's high-attention zone. Optionally collapse the source after promoting.
- **lcm_tag** — Batch tag and status operations on collapsed pointers. Add/remove tags for categorization. Set status (active/reference/stale) for lifecycle management. List pointers with tag/status filters.
- **lcm_budget** — Show context composition breakdown: where tokens are spent across system prompts, summaries, messages, pointers, scratchpad, and tool calls.
- **lcm_checkpoint** — Save and restore context state snapshots. Bookmark context at key moments and roll back later.
- **lcm_templates** — Save, retrieve, and expand named code/text templates with `{{VAR_NAME}}` placeholder substitution.
- **lcm_undo** — List and roll back LCM context operations (collapse, remove, replace). Restore points are created automatically before every mutating operation.

**Pointer system:**

- Pointer tags (JSON array) for categorization and relationship discovery
- Pointer status lifecycle: `active` → `reference` → `stale`
- Related pointers auto-discovered via shared tags in lcm_describe output
- Stored data field on pointers (JSON) for computation results, coefficients, etc.
- Progressive discovery: glance (tag) → peek (describe) → search (describe+query) → expand (full restore)

**Context assembly:**

- Context ref map (`§000`, `§001`, ...) for navigating summaries, pointers, and messages
- Pointer XML rendering with tags, status, and stored data attributes
- Scratchpad placement in high-attention tail zone
- Attention-aware assembly ordering

#### Changed (existing tools)

- **lcm_describe** — Now handles pointer IDs (`ptr_xxx`) with preview, stored data display, and related pointer discovery via shared tags. Added `query` parameter for searching within collapsed content without expanding.
- **assembler.ts** — Enhanced with pointer/scratchpad XML rendering, context ref map generation, and attention-zone placement logic.
- **engine.ts** — Extended tool registration for all new tools, config schema additions for scratchpad/collapse/undo/budget feature flags.
- **migration.ts** — Added pointer tags/status columns, checkpoint table, template table, restore points table.
- **summary-store.ts** — 600+ lines of new methods for pointer CRUD, tag/status operations, checkpoint save/restore, template management, and restore point tracking.
- **retrieval.ts** — Added pointer metadata inclusion in context assembly output.
- **openclaw.plugin.json** — New config schema properties: `scratchpadEnabled`, `scratchpadMaxTokens`, `collapseEnabled`, `middleCompressionThreshold`, `undoEnabled`, `budgetEnabled`, `contextWindow`.

#### Stats

- **4,600+ lines added** across 28 files
- **10 new tools** (upstream had 5)
- **280 tests passing** (268 new, zero regressions)
- **Zero breaking changes** to existing functionality

## 0.2.8

### Patch Changes

- 7c1afb6: Time-aware LCM: format timestamps in local tz, fix UTC drift in leaf scheduling.

## 0.2.7

### Patch Changes

- 38d6b45: SecretRef-backed auth-profile credentials + custom provider API URLs

## 0.2.6

### Patch Changes

- 0e2c3a3: feat(tui): add Anthropic OAuth setup-token support

## 0.2.5

### Patch Changes

- 70b954e: LCM publish test

## 0.2.4

### Patch Changes

- dff7f26: TUI quality-of-life, perf, and nav refinements

## 0.2.3

### Patch Changes

- fd4fa89: Summary depth tracking, metadata enrichment, subtree navigation, and expanded TUI features

## 0.2.2

### Patch Changes

- 6e8e508: Interactive terminal UI, improved auth handling, and FTS5 search

## 0.2.1

### Patch Changes

- 89e4880: Fix ESM packaging for Node.js

## 0.2.0

### Minor Changes

- 89e4880: This is the initial release (as a npm package) of lossless-claw, a lossless context management plugin for OpenClaw.
