/**
 * Claude Code writes the same `tool_result` boilerplate whenever the user
 * rejects a tool call, whichever tool it was, optionally followed by the words
 * the user typed instead. Shared by the renderers that collapse that text to a
 * status line.
 */
export interface ToolRejection {
  /** The user's own words, when they rejected the call with feedback. */
  feedback?: string;
}

const REJECTION_PREFIX = "The user doesn't want to proceed with this tool use.";
const USER_FEEDBACK_RE = /To tell you how to proceed, the user said:\s*([\s\S]*)$/;

/** Returns null when the text is not a rejection result. */
export function parseToolRejection(text: string): ToolRejection | null {
  if (!text.startsWith(REJECTION_PREFIX)) return null;
  const feedback = USER_FEEDBACK_RE.exec(text)?.[1]?.trim();
  return feedback ? { feedback } : {};
}
