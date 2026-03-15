# Task: Build lcm_tidy and lcm_promote tools

Build two new LCM tools in `~/.openclaw/extensions/lossless-claw/src/tools/`.

## Context

These tools follow the same patterns as existing LCM tools. Read these files first to understand the patterns:
- `src/tools/lcm-collapse-tool.ts` — collapse tool (creates pointers, uses flush, marks conversation managed)
- `src/tools/lcm-scratchpad-tool.ts` — scratchpad tool (read/write/append/replace_section)
- `src/tools/lcm-expand-active-tool.ts` — expand tool
- `index.ts` — how tools are registered

## Tool 1: lcm_tidy

**Purpose:** One-command context hygiene. Collapses stale tool results in bulk.

**File:** `src/tools/lcm-tidy-tool.ts`

**Export:** `createLcmTidyTool(opts: { deps: LcmDependencies; lcm: LcmContextEngine; sessionKey: string })`

**Parameters:**
- `keepRecentTurns` (number, optional, default 3) — How many recent assistant turns to preserve. Everything older gets collapsed.
- `target` (string, optional, enum: "tool_results" | "all") — What to collapse. Default "tool_results". "all" collapses all non-fresh messages.
- `dryRun` (boolean, optional, default false) — Preview what would be collapsed without doing it.

**Logic:**
1. Call `lcm.flushPendingMessages()` to ensure current turn is available
2. Get context items via the conversation store: `deps.conversationStore.getContextItems(conversationId)`
3. Identify the fresh tail boundary. Walk backward from the end to find the Nth most recent assistant message (where N = keepRecentTurns). Everything before that boundary is candidate for collapse.
4. From candidates, filter based on `target`:
   - "tool_results": only items where the underlying message role is "tool" (itemType === "message" and the source message has role "tool")
   - "all": all candidate items that are itemType === "message" (skip summaries, pointers, scratchpad — they're already compact)
5. For each candidate group of consecutive items, create a single pointer using the same collapse logic as lcm-collapse-tool:
   - Store source IDs
   - Create a pointer with auto-generated label (e.g., "Tool results from turns 5-12 (8 items)")
   - Replace context items with pointer
6. Mark conversation as managed
7. Return: `{ collapsed: number, tokensSaved: number, pointersCreated: string[], dryRun: boolean, message: string }`

**Important implementation notes:**
- Look at how lcm-collapse-tool.ts creates pointers. It calls `deps.summaryStore.createPointer()` and then replaces context items using `deps.conversationStore.replaceContextItemRange()`.
- The pointer creation and context item replacement pattern is the core of the collapse tool — reuse that same pattern.
- To determine message roles, you need to look up the actual messages. Context items have `sourceId` which maps to message IDs. Use `deps.conversationStore.getMessage(sourceId)` or similar to check the role.
- Actually, check the context_items table schema and what fields are available. The item may already have enough info to determine type without fetching the full message. Check `itemType` and any metadata fields.
- Group consecutive collapsible items into ranges to minimize the number of pointers created.

## Tool 2: lcm_promote

**Purpose:** Move an insight from any context item into the scratchpad's high-attention zone.

**File:** `src/tools/lcm-promote-tool.ts`

**Export:** `createLcmPromoteTool(opts: { deps: LcmDependencies; lcm: LcmContextEngine; sessionKey: string })`

**Parameters:**
- `source` (string, required) — What to promote. Accepts:
  - A pointer ID (e.g., "ptr_abc123") — promotes the pointer's label + stored data
  - A summary ID (e.g., "sum_abc123") — promotes the summary content
  - A context ref (e.g., "§042") — promotes that specific context item
- `section` (string, optional, default "Promoted") — Scratchpad section to append under
- `note` (string, optional) — Additional context to add with the promoted content
- `collapseSource` (boolean, optional, default false) — Whether to collapse the source item after promoting

**Logic:**
1. Resolve the source:
   - If pointer ID: get pointer from `deps.summaryStore.getPointer(pointerId)`, use label + data
   - If summary ID: get summary from `deps.summaryStore.getSummary(summaryId)`, use content
   - If context ref (§NNN): parse the ordinal, find the context item at that ordinal, get its content
2. Format the promoted content:
   ```
   - [source_id]: [content or label]
     [data if available, formatted as key: value pairs]
     [note if provided]
   ```
3. Read current scratchpad content
4. If section exists in scratchpad: append the promoted content to that section
5. If section doesn't exist: append new section with header + content
6. Write updated scratchpad
7. Optionally collapse the source (if collapseSource=true and source is a context item)
8. Return: `{ promoted: string, section: string, scratchpadTokens: number, message: string }`

**Important implementation notes:**
- The scratchpad is stored via `deps.conversationStore.getScratchpad(conversationId)` and `deps.conversationStore.setScratchpad(conversationId, content)`
- For section manipulation, look at how lcm-scratchpad-tool.ts handles `replace_section` — it parses markdown headers
- For context refs (§NNN), the ordinal is a hex number. Parse with `parseInt(ref.slice(1), 16)` to get the ordinal, then find the matching context item.

## Registration

In `index.ts`, add:
```typescript
import { createLcmTidyTool } from "./tools/lcm-tidy-tool.js";
import { createLcmPromoteTool } from "./tools/lcm-promote-tool.js";
```

And in the `register()` method, add registrations following the same pattern as other tools:
```typescript
api.registerTool(createLcmTidyTool({ deps, lcm, sessionKey }));
api.registerTool(createLcmPromoteTool({ deps, lcm, sessionKey }));
```

## Critical Notes

1. TypeScript with NO build step — `.ts` files loaded directly by tsx/ts-node
2. Import paths use `.js` extension (ESM convention): `import { foo } from "./bar.js"`
3. Follow the exact same tool creation pattern as existing tools (createXxxTool function that returns a tool definition object)
4. Read existing tool files to understand the exact return shape and how deps/lcm/sessionKey are used
5. All database operations go through deps.conversationStore or deps.summaryStore
6. Call `deps.conversationStore.markConversationManaged(conversationId)` after any mutation
7. The tool definition needs: name, description, parameters (JSON Schema), and execute function
8. Run `cd ~/.openclaw/extensions/lossless-claw && npx vitest run` after implementation to verify tests still pass
