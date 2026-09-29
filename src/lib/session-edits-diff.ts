import type { z } from "zod";
import { buildFilePatch, buildPatchFromHunks } from "./diff-utils";
import {
  FileEditToolUseResultSchema,
  type JsonlRecord,
  type StructuredPatchHunkSchema,
} from "./schemas";

type StructuredPatchHunk = z.infer<typeof StructuredPatchHunkSchema>;

/**
 * One file's net change across the aggregated Edit/Write/MultiEdit results.
 * `complete` is false when a snapshot was missing (`originalFile: null` on an
 * edit), so the full before/after is unknown and `patch` falls back to the
 * tool-reported hunks.
 */
export interface SessionEditFile {
  path: string;
  status: "added" | "modified";
  complete: boolean;
  oldContent: string | null;
  newContent: string | null;
  patch: string;
  additions: number;
  deletions: number;
}

interface AggregateOptions {
  /** Only count tool results whose own uuid or source assistant uuid is in this set. */
  turnUuids?: ReadonlySet<string>;
}

interface FileState {
  baselineKnown: boolean;
  /** Content before the first aggregated edit; null means the file did not exist. */
  baseline: string | null;
  /** Content after the latest aggregated edit; null means unknown. */
  current: string | null;
  hunks: StructuredPatchHunk[];
}

function applyReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string | null {
  if (replaceAll) {
    return oldString === "" ? null : content.split(oldString).join(newString);
  }
  const index = content.indexOf(oldString);
  if (index === -1) return null;
  return content.slice(0, index) + newString + content.slice(index + oldString.length);
}

function inScope(record: JsonlRecord, turnUuids: ReadonlySet<string> | undefined): boolean {
  if (turnUuids === undefined) return true;
  if (record.type !== "user") return false;
  return (
    (record.uuid !== undefined && turnUuids.has(record.uuid)) ||
    (record.sourceToolAssistantUUID !== undefined && turnUuids.has(record.sourceToolAssistantUUID))
  );
}

/**
 * Aggregate the session's file edits into one net diff per file, using the
 * content snapshots in each Edit/Write/MultiEdit `toolUseResult`. Needs no
 * git and works after the worktree is gone. Files whose net change is empty
 * (edited then reverted) are omitted.
 */
export function aggregateSessionEdits(
  records: readonly JsonlRecord[],
  options: AggregateOptions = {},
): SessionEditFile[] {
  const files = new Map<string, FileState>();

  for (const record of records) {
    if (record.type !== "user" || record.toolUseResult === undefined) continue;
    if (!inScope(record, options.turnUuids)) continue;
    const parsed = FileEditToolUseResultSchema.safeParse(record.toolUseResult);
    if (!parsed.success) continue;
    const result = parsed.data;
    const state = files.get(result.filePath);

    let snapshot: string | null | undefined;
    let createsFile = false;
    let next: string | null;
    if ("content" in result) {
      snapshot = result.originalFile;
      createsFile = result.type === "create";
      next = result.content;
    } else if ("edits" in result) {
      snapshot = result.originalFileContents;
      let content = typeof snapshot === "string" ? snapshot : (state?.current ?? null);
      for (const edit of result.edits) {
        if (content === null) break;
        content = applyReplace(
          content,
          edit.old_string,
          edit.new_string,
          edit.replace_all ?? false,
        );
      }
      next = content;
    } else {
      snapshot = result.originalFile;
      const before = typeof snapshot === "string" ? snapshot : (state?.current ?? null);
      next =
        before === null
          ? null
          : applyReplace(before, result.oldString, result.newString, result.replaceAll ?? false);
    }

    const hunks = result.structuredPatch ?? [];
    if (state === undefined) {
      files.set(result.filePath, {
        baselineKnown: createsFile || typeof snapshot === "string",
        baseline: typeof snapshot === "string" ? snapshot : null,
        current: next,
        hunks: [...hunks],
      });
    } else {
      state.current = next;
      state.hunks.push(...hunks);
    }
  }

  const output: SessionEditFile[] = [];
  for (const [path, state] of files) {
    const status = state.baselineKnown && state.baseline === null ? "added" : "modified";
    if (state.baselineKnown && state.current !== null) {
      if (state.baseline === state.current) continue;
      output.push({
        path,
        status,
        complete: true,
        oldContent: state.baseline,
        newContent: state.current,
        ...buildFilePatch(state.baseline, state.current, path),
      });
    } else if (state.hunks.length > 0) {
      output.push({
        path,
        status,
        complete: false,
        oldContent: null,
        newContent: state.current,
        ...buildPatchFromHunks(state.hunks, path),
      });
    }
  }
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

function isRealUserPrompt(record: JsonlRecord): boolean {
  if (record.type !== "user" || record.toolUseResult !== undefined) return false;
  if (record.isMeta === true || record.isCompactSummary === true) return false;
  const { content } = record.message;
  if (typeof content === "string") return true;
  return !content.some((block) => block.type === "tool_result");
}

/** The uuids of the prompt-to-prompt turn that contains `uuid`, or null when no record has it. */
export function findTurnUuids(records: readonly JsonlRecord[], uuid: string): Set<string> | null {
  let current = new Set<string>();
  let found = false;
  for (const record of records) {
    if (isRealUserPrompt(record)) {
      if (found) break;
      current = new Set();
    }
    const recordUuid = "uuid" in record ? record.uuid : undefined;
    if (typeof recordUuid === "string") {
      current.add(recordUuid);
      if (recordUuid === uuid) found = true;
    }
  }
  return found ? current : null;
}
