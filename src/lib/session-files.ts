import type { ResourceOccurrence, TextChunk } from "./session-resources";
import { occurrenceKey, scanSessionContent } from "./session-resources";
import {
  EditInputSchema,
  GlobInputSchema,
  GrepInputSchema,
  LSInputSchema,
  LSPInputSchema,
  MultiEditInputSchema,
  NotebookEditInputSchema,
  ReadInputSchema,
  WriteInputSchema,
} from "./tool-input-schemas";
import type { SessionContentBlock, SessionLine } from "./transcript";

export type ToolBucket = "read" | "editWrite" | "bash" | "grepGlob" | "other";
export type FileSourceKey = ToolBucket | "userMessage" | "agentMessage" | "thinking";

export interface FileEntry {
  path: string;
  absolutePath: string;
  occurrences: ResourceOccurrence[];
}

export interface SessionFiles {
  files: FileEntry[];
  totalCount: number;
  counts: Record<FileSourceKey, number>;
}

interface NormalizedPath {
  path: string;
  absolutePath: string;
}

interface CollectedFile {
  path: string;
  absolutePath: string;
  occurrences: Map<string, ResourceOccurrence>;
}

const sourceOrder: Record<ResourceOccurrence["source"], number> = {
  visible: 0,
  thinking: 1,
  tool: 2,
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(candidate: string, homeRoot: string): NormalizedPath | undefined {
  if (candidate.startsWith("~/") && candidate.length > 2) {
    return {
      path: candidate,
      absolutePath: `${homeRoot}${candidate.slice(1)}`,
    };
  }

  const homePrefix = `${homeRoot}/`;
  if (!candidate.startsWith(homePrefix) || candidate.length === homePrefix.length) return undefined;

  return {
    path: `~/${candidate.slice(homePrefix.length)}`,
    absolutePath: candidate,
  };
}

function chunkKey(chunk: TextChunk): string {
  return JSON.stringify([
    chunk.text,
    chunk.anchorIndex,
    chunk.source,
    chunk.role,
    chunk.tool ?? null,
  ]);
}

function occurrenceFromChunk(chunk: TextChunk): ResourceOccurrence {
  return {
    source: chunk.source,
    anchorIndex: chunk.anchorIndex,
    ...(chunk.anchorUuid === undefined ? {} : { anchorUuid: chunk.anchorUuid }),
    role: chunk.role,
    ...(chunk.tool === undefined ? {} : { tool: chunk.tool }),
  };
}

function compareOccurrences(left: ResourceOccurrence, right: ResourceOccurrence): number {
  if (left.anchorIndex !== right.anchorIndex) {
    return left.anchorIndex - right.anchorIndex;
  }
  if (left.source !== right.source) return sourceOrder[left.source] - sourceOrder[right.source];
  if (left.role !== right.role) return left.role < right.role ? -1 : 1;

  const leftTool = left.tool ?? "";
  const rightTool = right.tool ?? "";
  if (leftTool === rightTool) return 0;
  return leftTool < rightTool ? -1 : 1;
}

function compareFiles(left: FileEntry, right: FileEntry): number {
  if (left.path === right.path) return 0;
  return left.path < right.path ? -1 : 1;
}

function getTypedPath(
  block: Extract<SessionContentBlock, { type: "tool_use" }>,
): string | undefined {
  switch (block.name) {
    case "Read": {
      const result = ReadInputSchema.safeParse(block.input);
      return result.success ? result.data.file_path : undefined;
    }
    case "Edit": {
      const result = EditInputSchema.safeParse(block.input);
      return result.success ? result.data.file_path : undefined;
    }
    case "MultiEdit": {
      const result = MultiEditInputSchema.safeParse(block.input);
      return result.success ? result.data.file_path : undefined;
    }
    case "Write": {
      const result = WriteInputSchema.safeParse(block.input);
      return result.success ? (result.data.file_path ?? result.data.path) : undefined;
    }
    case "Glob": {
      const result = GlobInputSchema.safeParse(block.input);
      return result.success ? result.data.path : undefined;
    }
    case "Grep": {
      const result = GrepInputSchema.safeParse(block.input);
      return result.success ? result.data.path : undefined;
    }
    case "LSP": {
      const result = LSPInputSchema.safeParse(block.input);
      return result.success ? result.data.file_path : undefined;
    }
    case "NotebookEdit": {
      const result = NotebookEditInputSchema.safeParse(block.input);
      return result.success ? result.data.notebook_path : undefined;
    }
    case "LS": {
      const result = LSInputSchema.safeParse(block.input);
      return result.success ? result.data.path : undefined;
    }
    default:
      return undefined;
  }
}

export function getFileSourceKey(occurrence: ResourceOccurrence): FileSourceKey {
  if (occurrence.source === "visible") {
    return occurrence.role === "user" ? "userMessage" : "agentMessage";
  }
  if (occurrence.source === "thinking") return "thinking";

  switch (occurrence.tool) {
    case "Read":
      return "read";
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return "editWrite";
    case "Bash":
      return "bash";
    case "Grep":
    case "Glob":
    case "LS":
      return "grepGlob";
    default:
      return "other";
  }
}

export function extractSessionFiles(lines: SessionLine[], homeRoot: string): SessionFiles {
  const chunks = scanSessionContent(lines);
  const collectedFiles = new Map<string, CollectedFile>();
  const typedPathsByChunk = new Map<string, Set<string>>();

  const addPath = (
    candidate: string,
    occurrence: ResourceOccurrence,
  ): NormalizedPath | undefined => {
    const normalized = normalizePath(candidate, homeRoot);
    if (normalized === undefined) return undefined;

    const collected = collectedFiles.get(normalized.path) ?? {
      ...normalized,
      occurrences: new Map<string, ResourceOccurrence>(),
    };
    collected.occurrences.set(occurrenceKey(occurrence), occurrence);
    collectedFiles.set(normalized.path, collected);
    return normalized;
  };

  for (const line of lines) {
    if (line.type !== "user" && line.type !== "assistant") continue;
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type !== "tool_use") continue;
      const candidate = getTypedPath(block);
      if (candidate === undefined) continue;

      const occurrence: ResourceOccurrence = {
        source: "tool",
        anchorIndex: line.lineIndex,
        ...(line.uuid === undefined ? {} : { anchorUuid: line.uuid }),
        role: line.type,
        tool: block.name,
      };
      const normalized = addPath(candidate, occurrence);
      if (normalized === undefined) continue;

      const key = chunkKey({ text: JSON.stringify(block.input), ...occurrence });
      const typedPaths = typedPathsByChunk.get(key) ?? new Set<string>();
      typedPaths.add(normalized.path);
      typedPathsByChunk.set(key, typedPaths);
    }
  }

  const pathPattern = new RegExp(
    "(?:" + escapeRegExp(homeRoot) + "|~)/[^\\s'\"`(){}\\[\\]<>,;:\\\\]+",
    "g",
  );

  for (const chunk of chunks) {
    const typedPaths = typedPathsByChunk.get(chunkKey(chunk));
    for (const match of chunk.text.matchAll(pathPattern)) {
      const candidate = match[0].replace(/[.,;:!?]+$/, "");
      const normalized = normalizePath(candidate, homeRoot);
      if (normalized === undefined) continue;

      const isTruncatedTypedPath = Array.from(typedPaths ?? []).some(
        (typedPath) => typedPath !== normalized.path && typedPath.startsWith(normalized.path),
      );
      if (isTruncatedTypedPath) continue;

      addPath(candidate, occurrenceFromChunk(chunk));
    }
  }

  const files = Array.from(
    collectedFiles.values(),
    (file): FileEntry => ({
      path: file.path,
      absolutePath: file.absolutePath,
      occurrences: Array.from(file.occurrences.values()).sort(compareOccurrences),
    }),
  ).sort(compareFiles);

  const counts: Record<FileSourceKey, number> = {
    userMessage: 0,
    agentMessage: 0,
    read: 0,
    editWrite: 0,
    bash: 0,
    grepGlob: 0,
    thinking: 0,
    other: 0,
  };

  for (const file of files) {
    const fileSources = new Set(file.occurrences.map(getFileSourceKey));
    for (const key of fileSources) counts[key] += 1;
  }

  return {
    files,
    totalCount: files.length,
    counts,
  };
}
