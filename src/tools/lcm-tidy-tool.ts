import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { LcmContextEngine } from "../engine.js";
import type { LcmDependencies } from "../types.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";
import { resolveLcmConversationScope } from "./lcm-conversation-scope.js";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncate text to maxLen, appending "…" if truncated. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

/** Message info resolved during candidate collection. */
interface ResolvedMessage {
  messageId: number;
  ordinal: number;
  tokens: number;
  role: string;
  toolName: string | null;
  contentPreview: string;
}

const LcmTidySchema = Type.Object({
  keepRecentTurns: Type.Optional(
    Type.Number({
      description:
        "How many recent assistant turns to preserve. Everything older gets collapsed. Default 3.",
    }),
  ),
  target: Type.Optional(
    Type.String({
      description:
        'What to collapse: "tool_results" (default, only tool messages) or "all" (all non-fresh messages).',
      enum: ["tool_results", "all"],
    }),
  ),
  exclude: Type.Optional(
    Type.String({
      description:
        "Pattern to exclude from tidy. Items whose content, tool name, or role matches this substring (case-insensitive) will be preserved.",
    }),
  ),
  maxTokensPerPointer: Type.Optional(
    Type.Number({
      description:
        "Max tokens per collapsed pointer before splitting into multiple pointers. Default: no limit.",
    }),
  ),
  showUnused: Type.Optional(
    Type.Boolean({
      description:
        "When true, include a list of never-accessed pointers in the output. Default false.",
    }),
  ),
  dryRun: Type.Optional(
    Type.Boolean({
      description:
        "Preview what would be collapsed without doing it. Default false.",
    }),
  ),
  conversationId: Type.Optional(
    Type.Number({
      description: "Conversation ID. Defaults to the current session conversation.",
    }),
  ),
});

export function createLcmTidyTool(input: {
  deps: LcmDependencies;
  lcm: LcmContextEngine;
  sessionId?: string;
  sessionKey?: string;
}): AnyAgentTool {
  return {
    name: "lcm_tidy",
    label: "LCM Tidy",
    description:
      "One-command context hygiene. Collapses stale tool results (or all old messages) in bulk, " +
      "preserving only the most recent assistant turns. Creates expandable pointers for collapsed content.",
    parameters: LcmTidySchema,
    async execute(_toolCallId, params) {
      const p = params as Record<string, unknown>;
      const keepRecentTurns = typeof p.keepRecentTurns === "number" ? p.keepRecentTurns : 3;
      const target = typeof p.target === "string" ? p.target.trim() : "tool_results";
      const exclude = typeof p.exclude === "string" ? p.exclude.trim().toLowerCase() : undefined;
      const maxTokensPerPointer = typeof p.maxTokensPerPointer === "number" && p.maxTokensPerPointer > 0 ? p.maxTokensPerPointer : undefined;
      const showUnused = p.showUnused === true;
      const dryRun = p.dryRun === true;

      if (!["tool_results", "all"].includes(target)) {
        return jsonResult({ error: `Invalid target "${target}". Use "tool_results" or "all".` });
      }

      const conversationStore = input.lcm.getConversationStore();
      const summaryStore = input.lcm.getSummaryStore();

      // Resolve conversation
      const scope = await resolveLcmConversationScope({
        lcm: input.lcm,
        sessionKey: input.sessionKey,
        deps: input.deps,
        params: p,
      });

      if (!scope.conversationId) {
        return jsonResult({ error: "No conversation found for this session." });
      }

      const conversationId = scope.conversationId;

      // Step 1: Flush pending messages
      await input.lcm.flushPendingMessages();

      // Step 2: Get context items
      const contextItems = await summaryStore.getContextItems(conversationId);

      if (contextItems.length === 0) {
        return jsonResult({ collapsed: 0, tokensSaved: 0, pointersCreated: [], dryRun, message: "No context items found." });
      }

      // Step 3: Find the fresh tail boundary
      // Walk backward to find the Nth most recent assistant message
      let assistantCount = 0;
      let boundaryIndex = contextItems.length; // default: everything is candidate

      for (let i = contextItems.length - 1; i >= 0; i--) {
        const item = contextItems[i];
        if (item.itemType === "message" && item.messageId != null) {
          const msg = await conversationStore.getMessageById(item.messageId);
          if (msg && msg.role === "assistant") {
            assistantCount++;
            if (assistantCount >= keepRecentTurns) {
              boundaryIndex = i;
              break;
            }
          }
        }
      }

      // Candidates are everything before the boundary
      const candidates = contextItems.slice(0, boundaryIndex);

      if (candidates.length === 0) {
        return jsonResult({ collapsed: 0, tokensSaved: 0, pointersCreated: [], dryRun, message: "Nothing old enough to collapse." });
      }

      // Step 4: Resolve all candidate messages and filter based on target + exclude
      const collapsible: ResolvedMessage[] = [];

      for (let i = 0; i < candidates.length; i++) {
        const item = candidates[i];
        // Skip non-message items (summaries, pointers, scratchpad are already compact)
        if (item.itemType !== "message" || item.messageId == null) continue;

        const msg = await conversationStore.getMessageById(item.messageId);
        if (!msg) continue;

        if (target === "tool_results") {
          if (msg.role !== "tool") continue;
        }
        // For "all", include all message items

        // Resolve tool name from message parts (only for tool messages, to avoid unnecessary queries)
        let toolName: string | null = null;
        if (msg.role === "tool") {
          const parts = await conversationStore.getMessageParts(item.messageId);
          toolName = parts.find((p) => p.toolName)?.toolName ?? null;
        }

        // Exclusion filter: check content, tool name, AND role
        if (exclude) {
          const matchesContent = msg.content.toLowerCase().includes(exclude);
          const matchesToolName = toolName ? toolName.toLowerCase().includes(exclude) : false;
          const matchesRole = msg.role.toLowerCase().includes(exclude);
          if (matchesContent || matchesToolName || matchesRole) {
            continue;
          }
        }

        const tokens = msg.tokenCount > 0 ? msg.tokenCount : estimateTokens(msg.content);
        collapsible.push({
          messageId: item.messageId,
          ordinal: item.ordinal,
          tokens,
          role: msg.role,
          toolName,
          contentPreview: truncate(msg.content.replace(/\n/g, " ").trim(), 80),
        });
      }

      if (collapsible.length === 0) {
        return jsonResult({ collapsed: 0, tokensSaved: 0, pointersCreated: [], dryRun, message: "No collapsible items found." });
      }

      // Step 5: Group collapsible items into semantically coherent ranges.
      //
      // In "tool_results" mode: group adjacent tool messages freely (gap ≤ 4 ordinals)
      //   since they're all the same kind.
      // In "all" mode: group by role category to avoid mixing conversation messages
      //   with tool results. This keeps pointer labels meaningful and prevents
      //   user/assistant exchanges from being bundled with unrelated tool output.
      const MAX_ORDINAL_GAP = 4;

      type CollapsibleGroup = ResolvedMessage[];
      const groups: CollapsibleGroup[] = [];

      /** Classify a role into a grouping category */
      function roleCategory(role: string): string {
        if (role === "tool") return "tool";
        return "conversation"; // user, assistant, system
      }

      let currentGroup: CollapsibleGroup = [collapsible[0]];

      for (let i = 1; i < collapsible.length; i++) {
        const prev = collapsible[i - 1];
        const curr = collapsible[i];

        // Break group on ordinal gap
        const gapTooLarge = curr.ordinal - prev.ordinal > MAX_ORDINAL_GAP;

        // In "all" mode, also break on role category change
        const categoryChanged =
          target === "all" && roleCategory(curr.role) !== roleCategory(prev.role);

        if (gapTooLarge || categoryChanged) {
          groups.push(currentGroup);
          currentGroup = [curr];
        } else {
          currentGroup.push(curr);
        }
      }
      groups.push(currentGroup);

      let totalCollapsed = 0;
      let totalTokensSaved = 0;
      const pointersCreated: string[] = [];

      if (dryRun) {
        // Preview what would happen — only count the actual collapsible items
        // (no longer sweeping non-collapsible items caught in ordinal ranges)
        for (const group of groups) {
          const tokens = group.reduce((sum, item) => sum + item.tokens, 0);
          totalCollapsed += group.length;
          totalTokensSaved += tokens;
          const label = buildGroupLabel(group, target);
          pointersCreated.push(`(dry run) ${label}`);
        }

        return jsonResult({
          collapsed: totalCollapsed,
          tokensSaved: totalTokensSaved,
          pointersCreated,
          dryRun: true,
          message: `Dry run: would collapse ${totalCollapsed} items into ${groups.length} pointer(s), saving ~${totalTokensSaved} tokens.`,
        });
      }

      // Step 6: Create pointers for each group (process in reverse order to preserve ordinals)
      // If maxTokensPerPointer is set, split groups into subgroups that fit within the limit.
      for (let gi = groups.length - 1; gi >= 0; gi--) {
        const group = groups[gi];

        // Split into subgroups if maxTokensPerPointer is set
        const subgroups: CollapsibleGroup[] = [];
        if (maxTokensPerPointer && group.length > 0) {
          let current: CollapsibleGroup = [];
          let currentTokens = 0;
          for (const item of group) {
            if (current.length > 0 && currentTokens + item.tokens > maxTokensPerPointer) {
              subgroups.push(current);
              current = [];
              currentTokens = 0;
            }
            current.push(item);
            currentTokens += item.tokens;
          }
          if (current.length > 0) subgroups.push(current);
        } else {
          subgroups.push(group);
        }

        // Process subgroups in reverse order to preserve ordinals
        for (let si = subgroups.length - 1; si >= 0; si--) {
          const sub = subgroups[si];
          if (sub.length === 0) continue;

          const tokens = sub.reduce((sum, item) => sum + item.tokens, 0);
          const sourceIds = sub.map((item) => String(item.messageId));

          const pointerId = `ptr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
          const label = buildGroupLabel(sub, target);

          // Determine source type from actual content
          const hasToolMessages = sub.some((item) => item.role === "tool");
          const sourceType = hasToolMessages ? "tool_output" : "messages";

          input.deps.log.info(
            `[lcm:tidy] Collapsing ${sub.length} item(s) → ${pointerId}, saving ~${tokens} tokens`,
          );

          await summaryStore.insertPointer({
            pointerId,
            conversationId,
            label,
            sourceType,
            sourceIds,
            tokensSaved: tokens,
            status: "reference",
          });

          // Replace only the specific ordinals we're collapsing, not the full range.
          // This avoids sweeping non-collapsible items (summaries, pointers, non-matching
          // messages) that happen to fall between our target ordinals.
          const ordinals = sub.map((item) => item.ordinal);
          await summaryStore.replaceContextItemsWithPointer({
            conversationId,
            ordinals,
            pointerId,
          });

          totalTokensSaved += tokens;
          pointersCreated.push(pointerId);
        }

        totalCollapsed += group.length;
      }

      // Step 7: Mark conversation as managed
      await conversationStore.markConversationManaged(conversationId);

      const result: Record<string, unknown> = {
        collapsed: totalCollapsed,
        tokensSaved: totalTokensSaved,
        pointersCreated: pointersCreated.reverse(), // restore chronological order
        dryRun: false,
        message: `Collapsed ${totalCollapsed} items into ${pointersCreated.length} pointer(s), saving ~${totalTokensSaved} tokens.`,
      };

      // Show unused pointers if requested
      if (showUnused) {
        const unusedPointers = await summaryStore.getUnusedPointers(conversationId, 0);
        if (unusedPointers.length > 0) {
          result.unusedPointers = unusedPointers.map((ptr) =>
            `${ptr.pointerId} (${ptr.label}, ${ptr.tokensSaved} tokens)`
          );
        }
      }

      return jsonResult(result);
    },
  };
}

/**
 * Build a descriptive label for a group of collapsed items.
 *
 * For tool results: includes tool names (deduplicated).
 * For conversation messages: includes a preview of the first user message.
 */
function buildGroupLabel(group: ResolvedMessage[], target: string): string {
  const tokens = group.reduce((sum, item) => sum + item.tokens, 0);
  const count = group.length;

  if (target === "tool_results" || group.every((item) => item.role === "tool")) {
    // Collect unique tool names
    const toolNames = [...new Set(group.map((item) => item.toolName).filter(Boolean))] as string[];
    if (toolNames.length > 0) {
      const nameStr = toolNames.length <= 3
        ? toolNames.join(", ")
        : `${toolNames.slice(0, 3).join(", ")} +${toolNames.length - 3} more`;
      return `Tool results: ${nameStr} (${count} items, ~${tokens} tokens)`;
    }
    return `Tool results (${count} items, ~${tokens} tokens)`;
  }

  // Conversation messages — find the first user message for context
  const firstUser = group.find((item) => item.role === "user");
  if (firstUser && firstUser.contentPreview) {
    return `Discussion: "${truncate(firstUser.contentPreview, 60)}" (${count} items, ~${tokens} tokens)`;
  }

  // Fallback: list the roles present
  const roles = [...new Set(group.map((item) => item.role))];
  return `${roles.join("/")} messages (${count} items, ~${tokens} tokens)`;
}
