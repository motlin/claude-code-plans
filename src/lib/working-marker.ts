import { z } from "zod";
import { isRequestInterrupted } from "./session-utils";

/**
 * One signal in a session's current turn, normalized from transcript records
 * and live hook state. `progress` is any response that is not a tool call:
 * it ends a tool's activity label and any pending API retry.
 */
export type WorkingMarkerEvent =
  | { kind: "prompt"; at: number }
  | { kind: "tool"; at: number; label: string }
  | { kind: "progress"; at: number }
  | { kind: "retry"; at: number; attempt: number; maxRetries: number; error: string }
  | { kind: "interrupt"; at: number }
  | { kind: "stop"; at: number };

/** Upstream claude.ai/code's transcript tail marker (busy / stopping / retrying / hidden). */
export type WorkingMarkerState =
  | { status: "idle" }
  | { status: "stopping" }
  | { status: "working"; label: string; turnStartedAt: number; elapsedSeconds: number }
  | {
      status: "retrying";
      error: string;
      attempt: number;
      maxRetries: number;
      turnStartedAt: number;
      elapsedSeconds: number;
    };

const WORKING_LABEL = "Working…";

interface Turn {
  startedAt: number;
  label: string;
  retry: { attempt: number; maxRetries: number; error: string } | null;
  stopping: boolean;
}

export function workingMarkerState(
  events: readonly WorkingMarkerEvent[],
  now: number,
): WorkingMarkerState {
  let turn: Turn | null = null;
  for (const event of events) {
    if (event.kind === "prompt") {
      turn = { startedAt: event.at, label: WORKING_LABEL, retry: null, stopping: false };
      continue;
    }
    if (turn === null) continue;
    switch (event.kind) {
      case "tool":
        turn = { ...turn, label: event.label, retry: null };
        break;
      case "progress":
        turn = { ...turn, label: WORKING_LABEL, retry: null };
        break;
      case "retry":
        turn = {
          ...turn,
          retry: { attempt: event.attempt, maxRetries: event.maxRetries, error: event.error },
        };
        break;
      case "interrupt":
        turn = { ...turn, stopping: true };
        break;
      case "stop":
        turn = null;
        break;
    }
  }

  if (turn === null) return { status: "idle" };
  if (turn.stopping) return { status: "stopping" };
  const elapsedSeconds = Math.max(0, Math.floor((now - turn.startedAt) / 1000));
  if (turn.retry !== null) {
    return {
      status: "retrying",
      ...turn.retry,
      turnStartedAt: turn.startedAt,
      elapsedSeconds,
    };
  }
  return { status: "working", label: turn.label, turnStartedAt: turn.startedAt, elapsedSeconds };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${pad2(totalSeconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${pad2(minutes % 60)}m`;
}

export function workingMarkerText(state: WorkingMarkerState): string {
  switch (state.status) {
    case "idle":
      return "";
    case "stopping":
      return "Stopping…";
    case "working":
      return `${state.label} · ${formatElapsed(state.elapsedSeconds)}`;
    case "retrying":
      return `${state.error} · Retrying (${state.attempt}/${state.maxRetries}) · ${formatElapsed(state.elapsedSeconds)}`;
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const ToolInputFieldsSchema = z.object({
  file_path: z.string().optional(),
  pattern: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
});

/** The status-line label for a running tool; `input` is unknown for hook-only pending tools. */
export function toolActivityLabel(name: string, input: unknown): string {
  const parsed = ToolInputFieldsSchema.safeParse(input);
  const fields = parsed.success ? parsed.data : {};
  const file = fields.file_path === undefined ? "file" : basename(fields.file_path);
  switch (name) {
    case "Read":
      return `Reading ${file}`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `Editing ${file}`;
    case "Write":
      return `Writing ${file}`;
    case "Grep":
      return fields.pattern === undefined ? "Searching" : `Searching for ${fields.pattern}`;
    case "Glob":
      return "Finding files";
    case "Bash":
      return fields.description ?? "Running command";
    case "WebFetch":
      return fields.url === undefined ? "Fetching" : `Fetching ${hostname(fields.url)}`;
    case "WebSearch":
      return "Searching the web";
    case "Agent":
    case "Task":
      return fields.description ?? "Running agent";
    default:
      return `Using ${name}`;
  }
}

const ContentBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
});

const MarkerRecordSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  timestamp: z.string().optional(),
  isMeta: z.boolean().optional(),
  isSidechain: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  retryAttempt: z.number().optional(),
  maxRetries: z.number().optional(),
  error: z.unknown().optional(),
  message: z
    .object({ content: z.union([z.string(), z.array(ContentBlockSchema)]).optional() })
    .optional(),
});

type MarkerRecord = z.infer<typeof MarkerRecordSchema>;

const ErrorObjectSchema = z.object({
  formatted: z.string().optional(),
  message: z.string().optional(),
});

function errorHeadline(error: unknown): string {
  if (typeof error === "string") return error;
  const parsed = ErrorObjectSchema.safeParse(error);
  return (
    (parsed.success ? (parsed.data.formatted ?? parsed.data.message) : undefined) ?? "API error"
  );
}

function userEvent(record: MarkerRecord, at: number): WorkingMarkerEvent | null {
  if (record.isMeta === true || record.isCompactSummary === true) return null;
  const content = record.message?.content;
  if (content === undefined) return null;
  if (typeof content === "string") {
    return { kind: isRequestInterrupted(content) ? "stop" : "prompt", at };
  }
  if (content.length === 0) return null;
  if (content.some((block) => block.type === "tool_result")) return { kind: "progress", at };
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  return { kind: isRequestInterrupted(text) ? "stop" : "prompt", at };
}

function assistantEvent(record: MarkerRecord, at: number): WorkingMarkerEvent {
  const content = record.message?.content;
  const tools = Array.isArray(content) ? content.filter((block) => block.type === "tool_use") : [];
  const last = tools.at(-1);
  if (last === undefined) return { kind: "progress", at };
  return { kind: "tool", at, label: toolActivityLabel(last.name ?? "", last.input) };
}

function systemEvent(record: MarkerRecord, at: number): WorkingMarkerEvent | null {
  if (record.subtype === "turn_duration") return { kind: "stop", at };
  if (
    record.subtype === "api_error" &&
    record.retryAttempt !== undefined &&
    record.maxRetries !== undefined
  ) {
    return {
      kind: "retry",
      at,
      attempt: record.retryAttempt,
      maxRetries: record.maxRetries,
      error: errorHeadline(record.error),
    };
  }
  return null;
}

/** The main thread's turn signals from raw JSONL records, oldest first. */
export function markerEventsFromRecords(records: readonly unknown[]): WorkingMarkerEvent[] {
  const events: WorkingMarkerEvent[] = [];
  let lastAt = 0;
  for (const raw of records) {
    const parsed = MarkerRecordSchema.safeParse(raw);
    if (!parsed.success || parsed.data.isSidechain === true) continue;
    const record = parsed.data;
    const parsedAt = record.timestamp === undefined ? Number.NaN : Date.parse(record.timestamp);
    const at = Number.isNaN(parsedAt) ? lastAt : parsedAt;
    lastAt = at;
    let event: WorkingMarkerEvent | null = null;
    if (record.type === "user") event = userEvent(record, at);
    else if (record.type === "assistant") event = assistantEvent(record, at);
    else if (record.type === "system") event = systemEvent(record, at);
    if (event !== null) events.push(event);
  }
  return events;
}
