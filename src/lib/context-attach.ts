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

/** `text` in a code fence that its own backticks cannot close. */
export function formatFencedExcerpt(text: string, language?: string | null): string {
  const fence = fenceFor(text);
  return `${fence}${language ?? ""}\n${text}\n${fence}`;
}

export function formatAttachContext({ path, range, text, language }: AttachContextInput): string {
  const mention = `@${path}${lineSuffix(range)}`;
  if (text === undefined) return mention;
  return `${mention}\n${formatFencedExcerpt(text, language)}`;
}

/** A "Request changes" comment on a line, or a range of lines, of a diff. */
export interface ReviewComment {
  path: string;
  line: number;
  endLine?: number | undefined;
  text: string;
}

/** `path:line — comment`, or `path:start-end — comment` for a range. */
export function formatReviewComment({ path, line, endLine, text }: ReviewComment): string {
  const lines = endLine === undefined || endLine === line ? `${line}` : `${line}-${endLine}`;
  return `${path}:${lines} — ${text}`;
}

export function formatReviewComments(comments: readonly ReviewComment[]): string {
  return comments.map(formatReviewComment).join("\n\n");
}

/** Queued review comments go ahead of the prompt they are sent with. */
export function prependReviewComments(prompt: string, comments: readonly ReviewComment[]): string {
  if (comments.length === 0) return prompt;
  const blocks = formatReviewComments(comments);
  return prompt === "" ? blocks : `${blocks}\n\n${prompt}`;
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
