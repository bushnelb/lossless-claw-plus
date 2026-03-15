# Task: Attention-Aware Assembly Improvements

Build these three improvements in `~/.openclaw/extensions/lossless-claw/src/`.

## Improvement A: Better Formatting of Summaries and Pointers

### Problem
Summaries and pointers sit in the middle zone where attention is weakest. Research shows prompt formatting affects performance up to 40%. Currently they render as plain text blocks with no structural markers.

### Solution
Modify the assembler to format summaries and pointers with clear structural markers that help attention mechanisms identify them as distinct information units.

### Changes to src/assembler.ts

In the `resolveItem()` method (or wherever summary/pointer content is assembled into messages), wrap content with clear markers:

For **summaries**, the message content should be formatted as:
```
<summary id="sum_xxx" tokens="NNN" depth="N">
[existing summary content]
</summary>
```

For **collapsed pointers**, format as:
```
<collapsed id="ptr_xxx" tokens_saved="NNN" created="TIMESTAMP">
  [label text]
  [if has data: "[has stored data — available on expand]"]
  → lcm_expand_active(pointerId: "ptr_xxx") to restore
</collapsed>
```

This uses XML-like tags which research shows help attention mechanisms distinguish structural boundaries. The tags also serve as retrieval cues — each contains the ID needed to expand/restore.

### Implementation
Find where summary items and pointer items are resolved into AgentMessage content in the assembler. The key method is likely `resolveItem()` or a similar function that converts context_items into messages.

Look at the existing code to understand how summaries and pointers are currently rendered, then add the XML-like wrapper formatting.

## Improvement B: Scratchpad Section Replace Enhancement

### Problem  
The scratchpad's `replace_section` action should be more robust and support creating new sections when they don't exist.

### Changes to src/tools/lcm-scratchpad-tool.ts

Verify the `replace_section` action works correctly:
1. If section exists: replace just that section
2. If section doesn't exist: append new section
3. Support matching by partial header text (case-insensitive)
4. Preserve header level from existing section

If `replace_section` already works as described, no changes needed — just verify.

## Improvement C: Context Map Enhancement

### Problem
The context ref map (§000, §001, etc.) currently shows truncated previews. It could be more useful by showing token counts and item types more prominently.

### Changes to src/assembler.ts

In the `buildRefMap()` method, enhance the format to include token counts:
- Current: `§000 sum "User is asking about..."` 
- Enhanced: `§000 sum "User is asking about..." | §001 sum "User identified the root ca..."`

Actually, the current format already includes type info. The main enhancement would be to add token counts to help the agent make better collapse decisions:
- `§000 sum(250) "User is asking..." | §001 sum(180) "User identified..."`

This gives immediate visibility into which items are worth collapsing.

## CRITICAL NOTES

1. TypeScript with NO build step — files are `.ts` loaded directly
2. Import extensions use `.js` (ESM convention)
3. Don't break existing functionality — enhance formatting only
4. Test by checking that the assembler still produces valid message arrays
5. The assembler file is at `src/assembler.ts` — READ IT FIRST to understand the current rendering pipeline before making changes
6. Summary content is stored in the summaries table, pointer content in the pointers table
7. The getContextItems method returns items with types: 'message', 'summary', 'pointer', 'scratchpad'
