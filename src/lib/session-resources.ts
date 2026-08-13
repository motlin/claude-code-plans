import type { SessionContentBlock, SessionLine } from "./transcript";

export type ContentSource = "visible" | "tool" | "thinking";

export interface ResourceOccurrence {
  source: ContentSource;
  /**
   * Session-absolute JSONL record index of the owning message, which is what
   * the `#msg-<n>` DOM anchor is keyed by (see lib/message-anchor.ts).
   */
  anchorIndex: number;
  role: "user" | "assistant";
  /** Tool name, back-filled onto tool_result chunks from the owning tool_use. */
  tool?: string;
}

/** One flattened content block, ready to scan. */
export interface TextChunk extends ResourceOccurrence {
  text: string;
}

interface ToolUseOwner {
  anchorIndex: number;
  toolName: string;
}

/**
 * Files and links are extracted from the transcript window the client holds,
 * not from the whole JSONL (see lib/structured-transcript.ts): a session longer
 * than the window has records nobody has scanned yet. So every surface that
 * shows one of these counts renders it as a floor -- `12+` -- and explains the
 * remainder, rather than passing a partial tally off as the session's total.
 * Paging history in shrinks `unscannedRecordCount` towards zero, at which point
 * the count is the whole session's and the marks disappear.
 */
export function formatResourceCount(count: number, unscannedRecordCount: number): string {
  return unscannedRecordCount > 0 ? `${count}+` : String(count);
}

export function resourceCoverageNote(unscannedRecordCount: number): string | undefined {
  if (unscannedRecordCount <= 0) return undefined;

  const records =
    unscannedRecordCount === 1
      ? "1 earlier record has"
      : `${unscannedRecordCount} earlier records have`;
  const included = unscannedRecordCount === 1 ? "it" : "them";
  return `Counted from the loaded messages only — ${records} not been scanned. Load earlier messages to include ${included}.`;
}

function getContentBlocks(line: SessionLine): SessionContentBlock[] {
  if (line.type !== "user" && line.type !== "assistant") return [];
  const content = line.message?.content;
  return Array.isArray(content) ? content : [];
}

function getToolResultText(block: Extract<SessionContentBlock, { type: "tool_result" }>) {
  if (typeof block.content === "string") return block.content;
  if (!Array.isArray(block.content)) return undefined;

  return block.content
    .flatMap((part) => {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return [part.text];
      }
      return [];
    })
    .join("\n");
}

export function scanSessionContent(lines: SessionLine[]): TextChunk[] {
  const toolUseOwners = new Map<string, ToolUseOwner>();

  for (const line of lines) {
    for (const block of getContentBlocks(line)) {
      if (block.type === "tool_use") {
        toolUseOwners.set(block.id, { anchorIndex: line.lineIndex, toolName: block.name });
      }
    }
  }

  const chunks: TextChunk[] = [];

  for (const line of lines) {
    if (line.type !== "user" && line.type !== "assistant") continue;

    const anchorIndex = line.lineIndex;
    const content = line.message?.content;
    if (typeof content === "string") {
      chunks.push({ text: content, source: "visible", anchorIndex, role: line.type });
      continue;
    }

    for (const block of getContentBlocks(line)) {
      switch (block.type) {
        case "text":
          chunks.push({ text: block.text, source: "visible", anchorIndex, role: line.type });
          break;
        case "thinking":
          chunks.push({
            text: block.thinking,
            source: "thinking",
            anchorIndex,
            role: line.type,
          });
          break;
        case "tool_use":
          chunks.push({
            text: JSON.stringify(block.input),
            source: "tool",
            anchorIndex,
            role: line.type,
            tool: block.name,
          });
          break;
        case "tool_result": {
          const text = getToolResultText(block);
          if (text === undefined) break;

          const owner = toolUseOwners.get(block.tool_use_id);
          chunks.push({
            text,
            source: "tool",
            anchorIndex: owner?.anchorIndex ?? anchorIndex,
            role: line.type,
            ...(owner ? { tool: owner.toolName } : {}),
          });
          break;
        }
        case "image":
        case "document":
          break;
      }
    }
  }

  return chunks;
}
