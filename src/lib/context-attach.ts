/**
 * "Attach as context" (⇧⌘L) as on claude.ai/code: a file, line range or
 * selection becomes an `@path` mention, `@path#L<a>-<b>` for lines, followed
 * by a fenced excerpt when text was selected. The Files pane hands the snippet
 * to the session's composer through a per-session request bus.
 */

export interface LineRange {
  start: number;
  end: number;
}

export interface AttachContextInput {
  /** Path relative to the working directory, or absolute outside it. */
  path: string;
  range?: LineRange | undefined;
  /** Selected text, attached as a fenced excerpt. */
  text?: string | undefined;
  /** Fence info string, such as "typescript". */
  language?: string | null | undefined;
}

function lineSuffix(range: LineRange | undefined): string {
  if (range === undefined) return "";
  return range.start === range.end ? `#L${range.start}` : `#L${range.start}-${range.end}`;
}

/** A backtick fence longer than any backtick run inside `text`. */
function fenceFor(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

export function formatAttachContext({ path, range, text, language }: AttachContextInput): string {
  const mention = `@${path}${lineSuffix(range)}`;
  if (text === undefined) return mention;
  const fence = fenceFor(text);
  return `${mention}\n${fence}${language ?? ""}\n${text}\n${fence}`;
}

/**
 * Add a snippet to the end of a prompt: a one-line mention joins with a space,
 * a fenced excerpt starts on its own line, and either leaves the caret ready
 * for more typing.
 */
export function appendAttachment(prompt: string, snippet: string): string {
  const multiline = snippet.includes("\n");
  const separator = prompt === "" || /\s$/.test(prompt) ? "" : multiline ? "\n" : " ";
  return `${prompt}${separator}${snippet}${multiline ? "\n" : " "}`;
}

type Listener = (snippet: string) => void;

const listeners = new Map<string, Set<Listener>>();

/** Send a snippet to the session's composer; false when no composer is mounted for it. */
export function requestAttachContext(sessionId: string, snippet: string): boolean {
  const sessionListeners = listeners.get(sessionId);
  if (sessionListeners === undefined || sessionListeners.size === 0) return false;
  for (const listener of sessionListeners) listener(snippet);
  return true;
}

export function onAttachContextRequest(sessionId: string, listener: Listener): () => void {
  const sessionListeners = listeners.get(sessionId) ?? new Set();
  sessionListeners.add(listener);
  listeners.set(sessionId, sessionListeners);
  return () => {
    sessionListeners.delete(listener);
    if (sessionListeners.size === 0) listeners.delete(sessionId);
  };
}
