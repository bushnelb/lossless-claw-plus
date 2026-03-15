# Task: Build LCM Improvements #2-#6

Build all of the following improvements in `~/.openclaw/extensions/lossless-claw/src/`.
Follow existing patterns exactly. DO NOT modify any existing tests. Verify imports compile by checking patterns in existing files.

## Improvement #2 + #3: Budget-Aware Warnings in Assembler

### Config changes (src/db/config.ts)
Add to LcmConfig interface:
```typescript
/** Fraction of token budget above which a warning is injected (0.0-1.0, default 0.7). */
budgetWarningThreshold: number;
```

Add to `parseLcmConfig()`:
```typescript
budgetWarningThreshold: toNumber(pc.budgetWarningThreshold) ?? 0.7,
```

### Assembler changes (src/assembler.ts)

In the `assemble()` method, AFTER computing `estimatedTokens` and BEFORE the return statement, add budget warning logic:

```typescript
// Budget warning: if over threshold, suggest items to collapse
if (tokenBudget > 0) {
  const usageRatio = estimatedTokens / tokenBudget;
  const warningThreshold = input.budgetWarningThreshold ?? 0.7;
  
  if (usageRatio >= warningThreshold) {
    // Find the 5 largest items in selected (non-fresh-tail, non-scratchpad)
    const evictableWithTokens = selected
      .filter((_, idx) => idx < selected.length - freshTail.length - scratchpadItems.length)
      .map(item => ({ ordinal: item.ordinal, tokens: item.tokens, type: item.isMessage ? 'message' : (item.isSummary ? 'summary' : 'pointer') }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5);
    
    const pct = Math.round(usageRatio * 100);
    const warningLines = [
      `\n## ⚠️ Context Budget: ${pct}% used (${estimatedTokens}/${tokenBudget} tokens)`,
      `Consider collapsing large items to free space:`,
    ];
    for (const item of evictableWithTokens) {
      warningLines.push(`- Ordinal §${item.ordinal.toString(16).padStart(3, '0')} (${item.type}): ~${item.tokens} tokens`);
    }
    warningLines.push(`Use \`lcm_collapse\` with target "range:start-end" to collapse ranges.`);
    
    const warningText = warningLines.join('\n');
    systemPromptAddition = systemPromptAddition 
      ? systemPromptAddition + '\n' + warningText 
      : warningText;
  }
}
```

Also add `budgetWarningThreshold?: number` to the `AssembleContextInput` interface.

In `src/engine.ts`, in the `assemble()` method where `this.assembler.assemble()` is called, pass the config value:
```typescript
budgetWarningThreshold: this.config.budgetWarningThreshold,
```

## Improvement #4: Computation State in Collapse Tool

### Enhance lcm-collapse-tool.ts

Add an optional `data` parameter to the schema:
```typescript
data: Type.Optional(
  Type.String({
    description: "Structured data (JSON string) to store with the pointer. Included when expanded. Use for computation results, coefficients, etc.",
  }),
),
```

### Enhance pointers table (src/db/migration.ts)

Add `data TEXT` column to the pointers table. Add it as a nullable column in the CREATE TABLE. Also add a migration step that adds the column if it doesn't exist:
```sql
ALTER TABLE pointers ADD COLUMN data TEXT;
```
(Wrap in try-catch since it may already exist.)

### Enhance summary-store.ts

1. Add `data` field to `PointerRecord` type and `PointerRow` interface
2. Update `createPointer` to accept and store `data`
3. Update `getPointer` to return `data`
4. Update `toPointerRecord` to map the data field

### Enhance lcm-expand-active-tool.ts

When expanding a pointer, if it has `data`, include it in the expansion result:
```typescript
// After getting pointer record
if (pointer.data) {
  // Include structured data in the response
  result.data = pointer.data;
  result.message += ` Includes structured data payload.`;
}
```

### Enhance lcm-collapse-tool.ts

When creating a pointer, pass the `data` parameter through:
```typescript
const data = typeof p.data === "string" ? p.data : undefined;
// ... in createPointer call:
await summaryStore.createPointer({ ..., data });
```

## Improvement #5: Proof-State DAG (Scratchpad Enhancement)

This is the simplest approach — don't build a new tool. Instead, add a convention to the scratchpad tool that supports structured sections.

### Add to lcm-scratchpad-tool.ts schema:
```typescript
section: Type.Optional(
  Type.String({
    description: "Section header to replace (for replace_section action). Match by heading text, e.g. 'Active Context' matches '## Active Context'.",
  }),
),
```

### Add a new action: `replace_section`
When action is `replace_section`, find the section by heading and replace just that section's content:
```typescript
case "replace_section": {
  const section = typeof p.section === "string" ? p.section.trim() : "";
  if (!section) return jsonResult({ error: "section is required for replace_section." });
  if (!content) return jsonResult({ error: "content is required for replace_section." });
  
  const scratchpad = await summaryStore.getScratchpad(conversationId);
  if (!scratchpad) return jsonResult({ error: "No scratchpad exists. Use write first." });
  
  // Find section header (## Section Name)
  const lines = scratchpad.content.split('\n');
  const headerPattern = new RegExp(`^#{1,4}\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  let startIdx = -1;
  let endIdx = lines.length;
  
  for (let i = 0; i < lines.length; i++) {
    if (headerPattern.test(lines[i])) {
      startIdx = i;
      // Find next header of same or higher level
      const level = lines[i].match(/^(#+)/)?.[1].length ?? 2;
      for (let j = i + 1; j < lines.length; j++) {
        const match = lines[j].match(/^(#+)\s/);
        if (match && match[1].length <= level) {
          endIdx = j;
          break;
        }
      }
      break;
    }
  }
  
  if (startIdx === -1) {
    // Section not found, append it
    const newContent = scratchpad.content + `\n\n## ${section}\n${content}`;
    // ... save
  } else {
    // Replace section
    const before = lines.slice(0, startIdx);
    const after = lines.slice(endIdx);
    const newContent = [...before, `## ${section}`, content, ...after].join('\n');
    // ... save
  }
}
```

## Improvement #6: Computation Templates (New Tool)

### Create src/tools/lcm-templates-tool.ts

A simple key-value store for named code/text templates.

### New table (src/db/migration.ts):
```sql
CREATE TABLE IF NOT EXISTS templates (
  template_id TEXT PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  language TEXT DEFAULT 'python',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS templates_conv_name_idx ON templates (conversation_id, name);
```

### Tool actions:
- **save**: Save a named template. Params: name (required), content (required), language (optional, default 'python')
- **get**: Retrieve a template by name. Params: name (required). Returns the content.
- **list**: List all templates for current conversation.
- **delete**: Remove a template. Params: name (required).
- **expand**: Get template content with variable substitution. Params: name (required), vars (optional JSON object of variable replacements like {"N_COEFFS": "30", "DPS": "80"})

### Variable substitution:
Simple `{{VAR_NAME}}` pattern replacement:
```typescript
let result = template.content;
if (vars) {
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, String(value));
  }
}
```

### Store methods in summary-store.ts:
- `saveTemplate(input)` — upsert by (conversation_id, name)
- `getTemplate(conversationId, name)` — fetch by name
- `listTemplates(conversationId)` — list all
- `deleteTemplate(conversationId, name)` — delete by name

### Register in index.ts:
Follow the pattern of other tools.

## CRITICAL IMPLEMENTATION NOTES

1. **TypeScript with NO build step** — files are `.ts` loaded directly by OpenClaw's custom loader
2. **Import extensions** — use `.js` extension in imports (e.g., `import { foo } from "./bar.js"`) — this is the ESM convention used throughout the project
3. **Follow existing patterns** — look at lcm-scratchpad-tool.ts, lcm-checkpoint-tool.ts, lcm-undo-tool.ts for the exact tool structure
4. **Tool signature**: `export function createLcmXxxTool(input: { deps: LcmDependencies; lcm: LcmContextEngine; sessionId?: string; sessionKey?: string; }): AnyAgentTool`
5. **jsonResult()** from `./common.js` for all return values
6. **resolveLcmConversationScope()** from `./lcm-conversation-scope.js` for getting conversationId
7. **Don't break existing code** — add, don't modify signatures unless extending
8. **Migration safety** — wrap ALTER TABLE in try-catch for column additions to existing tables
