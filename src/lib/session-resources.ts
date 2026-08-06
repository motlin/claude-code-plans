import type { SessionContentBlock, SessionLine } from "./transcript";

export type ContentSource = "visible" | "tool" | "thinking";

export interface ResourceOccurrence {
  source: ContentSource;
  /** Index into the lines array, matching the msg-<n> DOM anchor convention. */
  lineArrayIndex: number;
  role: "user" | "assistant";
  /** Tool name, back-filled onto tool_result chunks from the owning tool_use. */
  tool?: string;
}

/** One flattened content block, ready to scan. */
export interface TextChunk extends ResourceOccurrence {
  text: string;
}

interface ToolUseOwner {
  lineArrayIndex: number;
  toolName: string;
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

  for (const [lineArrayIndex, line] of lines.entries()) {
    for (const block of getContentBlocks(line)) {
      if (block.type === "tool_use") {
        toolUseOwners.set(block.id, { lineArrayIndex, toolName: block.name });
      }
    }
  }

  const chunks: TextChunk[] = [];

  for (const [lineArrayIndex, line] of lines.entries()) {
    if (line.type !== "user" && line.type !== "assistant") continue;

    const content = line.message?.content;
    if (typeof content === "string") {
      chunks.push({ text: content, source: "visible", lineArrayIndex, role: line.type });
      continue;
    }

    for (const block of getContentBlocks(line)) {
      switch (block.type) {
        case "text":
          chunks.push({ text: block.text, source: "visible", lineArrayIndex, role: line.type });
          break;
        case "thinking":
          chunks.push({
            text: block.thinking,
            source: "thinking",
            lineArrayIndex,
            role: line.type,
          });
          break;
        case "tool_use":
          chunks.push({
            text: JSON.stringify(block.input),
            source: "tool",
            lineArrayIndex,
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
            lineArrayIndex: owner?.lineArrayIndex ?? lineArrayIndex,
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
