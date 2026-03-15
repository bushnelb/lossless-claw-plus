# Task: Add Pointer Peek to lcm_describe + Token Counts

Two changes to enable progressive discovery of collapsed pointer content.

## Change 1: lcm_describe handles pointer IDs

**File:** `src/tools/lcm-describe-tool.ts`

Currently `lcm_describe` only handles `sum_xxx` and `file_xxx` IDs. Add support for `ptr_xxx` IDs.

**When a ptr_xxx ID is provided:**

1. Look up the pointer: The pointers table has columns like `pointer_id`, `conversation_id`, `label`, `data`, `source_ids`, `created_at`. Check the actual schema by reading the migration file or store code.

2. Look up the source messages: The pointer stores which message IDs were collapsed into it (source_ids, likely JSON array). Fetch those messages from the messages table.

3. Return a structured response:
```json
{
  "id": "ptr_xxx",
  "type": "pointer",
  "label": "Tool results from turns 5-12",
  "data": { ... },  // stored JSON data, if any
  "sourceCount": 8,
  "totalTokens": 5200,
  "created": "2026-03-14T...",
  "preview": "First ~500 chars of concatenated source content...",
  "sources": [
    { "id": "msg_123", "role": "tool", "tokens": 650, "preview": "First 100 chars..." },
    { "id": "msg_124", "role": "assistant", "tokens": 200, "preview": "First 100 chars..." }
  ]
}
```

**Key:** The preview gives Level 2 depth without restoring everything to context. Show enough to decide whether to fully expand.

**Implementation approach:**
- Read `src/tools/lcm-describe-tool.ts` to understand current structure
- Read the pointer-related store methods (check `src/store/summary-store.ts` or `src/store/conversation-store.ts` for getPointer or similar)
- Read `src/db/migration.ts` to understand the pointers table schema
- Add a branch in the tool's execute function for `ptr_` prefixed IDs
- Fetch pointer record, then fetch source messages, build preview response

## Change 2: Add grep-within-pointer capability

Add an optional `pointerId` parameter to `lcm_describe`:

**New parameter:** `query` (string, optional) — If provided along with a ptr_xxx ID, search within the pointer's source messages for this pattern (simple substring or regex match). Return only matching source messages with highlighted snippets.

Response when query is provided:
```json
{
  "id": "ptr_xxx",
  "query": "alpha",
  "matches": [
    { "id": "msg_123", "role": "tool", "snippet": "...computed alpha = -2.5029...", "tokens": 650 }
  ],
  "totalSources": 8,
  "matchCount": 2
}
```

This lets the agent search inside collapsed content without expanding it.

**Add the `query` parameter to the tool's JSON Schema parameters definition.**

## Change 3: Verify pointer display format

Check `src/assembler.ts` where collapsed pointers are formatted. They should already show `tokens_saved` in the XML tag. Verify the format looks like:

```
<collapsed id="ptr_xxx" tokens_saved="5200" created="TIMESTAMP">
  Label text here
  [has stored data — available on expand]
  → lcm_expand_active(pointerId: "ptr_xxx") to restore
</collapsed>
```

If `tokens_saved` is not being set correctly (e.g., it's 0 or missing), fix it. The token count should reflect the actual tokens of the source messages that were collapsed.

**Check:** Is `tokens_saved` stored in the pointers table, or computed at assembly time? If computed, make sure the computation is correct. If stored, make sure it's set correctly during collapse operations.

## Critical Notes

1. TypeScript, NO build step, .ts loaded directly
2. Import paths use `.js` extension (ESM convention)
3. Read existing code first to understand patterns
4. Don't break existing lcm_describe functionality for sum_xxx and file_xxx
5. All DB access through existing store methods — add new store methods if needed
6. Run `cd ~/.openclaw/extensions/lossless-claw && npx vitest run` after to verify tests pass
