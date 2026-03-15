# Task: Fix 6 Pain Points in LCM Tools

Build improvements to existing LCM tools in `~/.openclaw/extensions/lossless-claw/src/`.

READ existing tool files first to understand patterns before making changes.

## Pain Point 1: Pre-flight Size Check on Read Tool Results

### Problem
The LCM engine has no way to warn or intercept when a large tool result is about to land in context. A single `Read` of a large file can dump 20k tokens into the middle zone.

### Solution
The LCM engine already has a `largeFileTokenThreshold` config (default 25000). Enhance the existing large file interception in the engine to:

1. In `afterTurn()` or wherever messages are ingested, when a tool result message exceeds a configurable token threshold (e.g., 5000 tokens), add a system-level annotation to the stored message metadata noting its size.

2. More importantly: in the `systemPromptAddition` that gets injected, add a **context budget line** showing current usage. This way the agent always knows its budget before making tool calls.

### Changes to src/engine.ts or src/assembler.ts

In the `buildSystemPromptAddition()` method (or equivalent), add a line like:
```
Context budget: ~{used}k/{total}k tokens ({percent}%). {warning if > threshold}
```

This is lightweight and gives the agent the info it needs to make smart decisions about what to read.

### Also: Add token estimate to collapse output
When any collapse operation runs, include `estimatedContextTokens` in the response so the agent knows current usage after collapsing.

## Pain Point 2: `last_tool:all` — Collapse All Tool Results from Current Turn

### Problem
When multiple different tools run in one turn (Read, exec, session_status), collapsing requires multiple targeted calls. Need a way to collapse everything at once.

### Changes to src/tools/lcm-collapse-tool.ts

Add support for `last_tool:all` target (no tool name specified after `last_tool:`):
- When target is exactly `last_tool:all`, find ALL tool call/result pairs in the current turn (not just one tool type)
- Walk backward from the end of context items, collecting all tool-type messages until hitting a non-tool message (like an assistant message without tool calls)
- Group them into a single pointer
- The label should describe what was collapsed: "All tool results from current turn (N items: Read, exec, ...)"

Update the parameter description/enum to document this new option.

## Pain Point 3: Tidy with Exclusions

### Problem  
`lcm_tidy` collapses everything older than N turns, but sometimes you want to keep specific results.

### Changes to src/tools/lcm-tidy-tool.ts

Add an `exclude` parameter:
- Type: string (optional)
- Description: "Pattern to exclude from tidy. Items whose content or label matches this substring (case-insensitive) will be preserved."
- When processing candidates for collapse, skip any item where the message content contains the exclude pattern

Example: `lcm_tidy(exclude: "engine.ts")` — collapses everything except tool results mentioning engine.ts.

Also add a `maxTokensPerPointer` parameter (optional, default: no limit) that controls how many tokens go into a single pointer before splitting into multiple pointers. This prevents creating one massive pointer for an entire session's worth of tool results.

## Pain Point 4: Scratchpad Auto-timestamps

### Problem
Scratchpad sections go stale but there's no way to know when they were last updated.

### Changes to src/tools/lcm-scratchpad-tool.ts

When writing or replacing a section, automatically append a timestamp comment to the section:

For `replace_section`: add `<!-- updated: ISO-timestamp -->` at the end of the section content.

For `write`: add `<!-- written: ISO-timestamp -->` at the very end of the content.

For `append`: add `<!-- appended: ISO-timestamp -->` after the appended content.

When `read` is called: scan for these timestamp comments and if any section hasn't been updated in more than 30 minutes (configurable), add a note in the read output: "⚠️ Section 'X' last updated 45min ago — may be stale"

### Implementation
The timestamps should be HTML comments so they don't clutter the visual output but are parseable. Use the format `<!-- updated: 2026-03-14T13:45:00Z -->`.

For staleness detection on read: parse the scratchpad looking for section headers (## or ###) and their associated timestamps. Compare against current time. Add warnings to the output message (not the content itself — the response message field).

## Pain Point 5: Cross-session Scratchpad Seeding

### Problem
The scratchpad starts empty each session. Could be pre-populated from a workspace state file.

### Changes to src/engine.ts

In the `bootstrap()` method (or wherever the engine initializes for a session), check if the scratchpad for this conversation is empty. If it is:

1. Look for a file called `WORKSPACE_STATE.md` in the current working directory (use `process.cwd()`)
2. If found, read it and set it as the initial scratchpad content
3. Add a header: `<!-- auto-seeded from WORKSPACE_STATE.md at ISO-timestamp -->`
4. Mark the conversation as managed

This is a one-time seed — once the scratchpad has content, it won't re-seed from the file.

### Important
- Only seed if scratchpad is empty/null for this conversation
- Don't overwrite existing scratchpad content
- Keep it simple — just read the file and set it as scratchpad
- If the file doesn't exist, do nothing (no error)

## Pain Point 6: Pointer Access Tracking

### Problem
No way to know which pointers have been accessed vs sitting unused.

### Changes to src/store/summary-store.ts (or wherever pointers are stored)

Add an `accessed_at` column to the pointers table:
- Add migration to add `accessed_at TEXT` column (nullable)
- When `getPointer()` is called (during expand or describe), update `accessed_at` to current timestamp
- Add a method `getUnusedPointers(conversationId, olderThanMinutes)` that returns pointers where accessed_at is NULL or older than N minutes

### Changes to src/tools/lcm-tidy-tool.ts

Add a `showUnused` parameter (boolean, optional, default false):
- When true, include a list of unused pointers in the output: "Never accessed: ptr_xxx (label, N tokens), ptr_yyy (label, M tokens)"
- This helps the agent decide what to clean up

### Changes to lcm_describe for pointers

When describing a pointer, include `accessed_at` in the output if available: "Last accessed: 30 minutes ago" or "Never accessed".

## CRITICAL Implementation Notes

1. TypeScript with NO build step — files are `.ts` loaded directly
2. Import extensions use `.js` (ESM convention)
3. READ existing files before modifying — understand the patterns
4. Don't break existing functionality
5. Run `cd ~/.openclaw/extensions/lossless-claw && npx vitest run` after all changes to verify tests pass
6. The migration system is in `src/db/migration.ts` — add new migrations at the end of the migration list, don't modify existing ones
7. For database schema changes, add a new migration step that ALTERs the table (don't modify the CREATE TABLE)
8. Context items have: id, conversationId, ordinal, itemType, sourceId, tokenEstimate, metadata
9. The engine has access to deps.conversationStore and deps.summaryStore for all DB operations
