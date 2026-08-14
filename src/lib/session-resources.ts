import type { SessionContentBlock, SessionLine } from "./transcript";

export type ContentSource = "visible" | "tool" | "thinking";

export interface ResourceOccurrence {
  source: ContentSource;
  /**
   * Session-absolute JSONL record index of the owning message. It orders and
   * de-dupes the mentions, and locates the row when the owning message renders
   * no row of its own (see lib/jump-to-message.ts).
   */
  anchorIndex: number;
  /**
   * uuid of the owning message, which is how a mention still on the server is
   * recognized once history is paged in (see hooks/use-pending-message-jump.ts).
   * Absent for the rare record that carries no uuid, whose mentions are only
   * reachable while the window already holds them.
   */
  anchorUuid?: string | undefined;
  role: "user" | "assistant";
  /** Tool name, back-filled onto tool_result chunks from the owning tool_use. */
  tool?: string | undefined;
}

/**
 * Identity of a mention within one resource: which message it sits in and how
 * it got there. A single message mentions the same file or URL over and over --
 * a path repeated through a diff, a link echoed in a tool result -- and every
 * repeat produces an identical chip. Collapsing them on this key is what keeps
 * a whole-session inventory to a payload worth serving.
 */
export function occurrenceKey(occurrence: ResourceOccurrence): string {
  return JSON.stringify([
    occurrence.anchorIndex,
    occurrence.source,
    occurrence.role,
    occurrence.tool ?? null,
  ]);
}

/** One flattened content block, ready to scan. */
export interface TextChunk extends ResourceOccurrence {
  text: string;
}

/** Where a chunk's owning message lives: its record index, and its uuid anchor. */
type ChunkAnchor = Pick<ResourceOccurrence, "anchorIndex" | "anchorUuid">;

interface ToolUseOwner {
  anchor: ChunkAnchor;
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

function lineAnchor(line: { lineIndex: number; uuid?: string | undefined }): ChunkAnchor {
  return {
    anchorIndex: line.lineIndex,
    ...(line.uuid === undefined ? {} : { anchorUuid: line.uuid }),
  };
}

export function scanSessionContent(lines: SessionLine[]): TextChunk[] {
  const toolUseOwners = new Map<string, ToolUseOwner>();

  for (const line of lines) {
    if (line.type !== "user" && line.type !== "assistant") continue;
    for (const block of getContentBlocks(line)) {
      if (block.type === "tool_use") {
        toolUseOwners.set(block.id, { anchor: lineAnchor(line), toolName: block.name });
      }
    }
  }

  const chunks: TextChunk[] = [];

  for (const line of lines) {
    if (line.type !== "user" && line.type !== "assistant") continue;

    const anchor = lineAnchor(line);
    const content = line.message?.content;
    if (typeof content === "string") {
      chunks.push({ text: content, source: "visible", ...anchor, role: line.type });
      continue;
    }

    for (const block of getContentBlocks(line)) {
      switch (block.type) {
        case "text":
          chunks.push({ text: block.text, source: "visible", ...anchor, role: line.type });
          break;
        case "thinking":
          chunks.push({
            text: block.thinking,
            source: "thinking",
            ...anchor,
            role: line.type,
          });
          break;
        case "tool_use":
          chunks.push({
            text: JSON.stringify(block.input),
            source: "tool",
            ...anchor,
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
            ...(owner ? owner.anchor : anchor),
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
