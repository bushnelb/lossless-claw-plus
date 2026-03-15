# Task: Build LCM Context Checkpoint Tool

## What to Build

A new LCM tool called `lcm_checkpoint` that saves and restores context state snapshots.

## Location

All code goes in `~/.openclaw/extensions/lossless-claw/src/`

## Architecture

### New Table (add to src/db/migration.ts)

```sql
CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  context_snapshot TEXT NOT NULL,  -- JSON array of context_items rows
  scratchpad_snapshot TEXT,        -- scratchpad content at save time
  token_count INTEGER DEFAULT 0,  -- estimated tokens at save time
  item_count INTEGER DEFAULT 0,   -- number of context items
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
);
```

### Store Methods (add to src/store/summary-store.ts)

Add these methods to the SummaryStore class:

1. `saveCheckpoint(input: { checkpointId: string, conversationId: number, name: string, description?: string, contextSnapshot: string, scratchpadSnapshot?: string, tokenCount: number, itemCount: number })` — insert into checkpoints table

2. `getCheckpoint(checkpointId: string): CheckpointRecord | null` — fetch by ID

3. `listCheckpoints(conversationId: number): CheckpointRecord[]` — list all for conversation, ordered by created_at desc

4. `deleteCheckpoint(checkpointId: string): boolean` — delete by ID

5. `restoreCheckpoint(conversationId: number, snapshot: ContextItemRow[])` — delete all context_items for conversation and re-insert from snapshot

### Tool (create src/tools/lcm-checkpoint-tool.ts)

Actions:
- **save**: Snapshot current context_items + scratchpad. Requires `name` parameter. Optional `description`.
  - Generate checkpoint_id like `cp_` + random hex
  - Read current context_items for the conversation
  - Read current scratchpad content
  - Estimate token count from context items
  - Save to checkpoints table
  - Return: checkpoint_id, name, item_count, token_count

- **list**: Show available checkpoints for current conversation.
  - Return: array of {checkpoint_id, name, description, item_count, token_count, created_at}

- **restore**: Restore context from a checkpoint. Requires `checkpointId` parameter.
  - Create a restore point first (using existing restore_points mechanism)
  - Delete current context_items for the conversation
  - Insert context_items from checkpoint snapshot
  - Optionally restore scratchpad (if `restoreScratchpad: true`)
  - Return: confirmation with item_count and estimated tokens

- **delete**: Remove a checkpoint. Requires `checkpointId` parameter.

### Tool Registration (modify src/index.ts)

Follow the exact same pattern as existing tools:
1. Import `createLcmCheckpointTool` from the new file
2. Register with `api.registerTool(createLcmCheckpointTool({ deps, lcm, sessionKey }))`

## Existing Patterns to Follow

Look at these files for patterns:
- `src/tools/lcm-undo-tool.ts` — similar save/restore pattern with restore_points
- `src/tools/lcm-scratchpad-tool.ts` — similar multi-action tool pattern
- `src/tools/lcm-collapse-tool.ts` — for conversation scope resolution
- `src/tools/lcm-conversation-scope.ts` — for resolving conversationId from sessionKey

The tool should use `resolveConversationScope` from `lcm-conversation-scope.ts` to get the conversationId.

## Dependencies Pattern

Every tool receives `{ deps, lcm, sessionKey }` where:
- `deps` is LcmDependencies (has log, config, etc.)
- `lcm` is the LcmContextEngine instance (has `.getSummaryStore()`, `.getConversationStore()`)
- `sessionKey` is the current session identifier

Access stores via:
```typescript
const summaryStore = lcm.getSummaryStore();
const conversationStore = lcm.getConversationStore();
```

## Important Notes

1. The project uses TypeScript with NO build step — files are `.ts` but loaded directly
2. All existing tests (272) must still pass: `cd ~/.openclaw/extensions/lossless-claw && node --test`
3. The context_items table has columns: conversation_id, ordinal, item_type, message_id, summary_id, pointer_id, created_at
4. The checkpoint snapshot should store ALL columns of each context_item row as JSON
5. Use crypto.randomUUID() or similar for generating checkpoint IDs (prefix with `cp_`)
6. Include estimatedContextTokens in save/restore responses (use lcm_budget pattern)

## Testing

After implementation, verify:
1. `node --test` passes all existing tests
2. The new table is created on startup (migration runs)
3. Tool is registered and appears in tool list
