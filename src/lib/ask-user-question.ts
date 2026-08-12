/**
 * Helpers for the AskUserQuestion tool flow used by the web viewer when
 * answering a pending prompt in an active session.
 */

export interface QuestionLike {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

interface AnswerEntry {
  question: string;
  answer: string;
}

interface Envelope {
  prefix: string;
  suffix: string;
}

const CURRENT_ENVELOPE: Envelope = {
  prefix: "Your questions have been answered: ",
  suffix: ". You can now continue with these answers in mind.",
};

/** Wording written by older Claude Code versions, still on disk in old sessions. */
const LEGACY_ENVELOPE: Envelope = {
  prefix: "User has answered your questions: ",
  suffix: ". You can now continue with the user's answers in mind.",
};

const ENVELOPES: readonly Envelope[] = [CURRENT_ENVELOPE, LEGACY_ENVELOPE];

/**
 * Format an AskUserQuestion answer set into the user-prompt text that the
 * resumed Claude Code session will receive. The wording mirrors the format
 * Claude Code itself produces in the `tool_result` content when the user
 * answers via the TUI:
 *   "Your questions have been answered: \"Q1\"=\"A1\". You can now continue..."
 *
 * Including the toolUseId in the message helps the resumed model correlate
 * the answer back to the still-pending tool call. Custom 'Other' entries are
 * passed through verbatim as the answer value.
 */
export function formatAnswerPrompt(toolUseId: string, answers: AnswerEntry[]): string {
  const pieces = answers.map((a) => `"${escapeQuote(a.question)}"="${escapeQuote(a.answer)}"`);
  return [
    `(Answering AskUserQuestion ${toolUseId} from the web viewer.)`,
    `${CURRENT_ENVELOPE.prefix}${pieces.join(", ")}${CURRENT_ENVELOPE.suffix}`,
  ].join(" ");
}

function escapeQuote(value: string): string {
  return value.replace(/"/g, '\\"');
}

/**
 * Normalize the polymorphic AskUserQuestion `tool_use.input` shape into a flat
 * array of questions. Supports both the multi-question form (`questions`) and
 * the older single-question form (`question` + `options`). Returns null when
 * neither form is present (e.g. malformed input).
 */
export function normalizeQuestions(input: Record<string, unknown>): QuestionLike[] | null {
  const multi = input["questions"];
  if (Array.isArray(multi) && multi.length > 0) {
    return multi as QuestionLike[];
  }
  const singleQ = typeof input["question"] === "string" ? (input["question"] as string) : null;
  const singleOpts = input["options"] as Array<{ label: string; description?: string }> | undefined;
  if (singleQ && singleOpts && singleOpts.length > 0) {
    const data: QuestionLike = { question: singleQ, options: singleOpts };
    if (typeof input["multiSelect"] === "boolean") data.multiSelect = input["multiSelect"];
    if (typeof input["header"] === "string") data.header = input["header"] as string;
    return [data];
  }
  return null;
}

export interface QuestionDraft {
  selected: Set<string>;
  otherText: string;
  useOther: boolean;
}

export function makeInitialDraft(): QuestionDraft {
  return { selected: new Set(), otherText: "", useOther: false };
}

/**
 * Project a draft into the final answer string for a question. Returns null
 * when no answer has been chosen (no selection, or 'Other' selected with empty
 * text). For multiSelect questions, joins selected labels with ', '.
 */
export function answerForQuestion(question: QuestionLike, draft: QuestionDraft): string | null {
  if (draft.useOther) {
    const trimmed = draft.otherText.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const selected = [...draft.selected];
  if (selected.length === 0) return null;
  if (question.multiSelect) return selected.join(", ");
  return selected[0] ?? null;
}

export interface ParsedAnswer {
  question: string;
  answer: string;
  notes: string | null;
}

const NOTES_MARKER = " user notes: ";
const PREVIEW_MARKER = " selected preview:";
const PAIR_SEPARATOR = ", ";

/**
 * Parse the canonical AskUserQuestion `tool_result.content` text into a
 * structured list of {question, answer, notes} entries. Returns null when the
 * text does not match the expected envelope or no questions were supplied.
 *
 * The text format mirrors what Claude Code's CLI writes back to the model:
 *   Your questions have been answered: "Q1"="A1"[ user notes: N1], "Q2"="A2"[...]. You can now continue with these answers in mind.
 * Both the current and legacy envelope wordings in ENVELOPES are accepted.
 *
 * Question titles are matched against the supplied `questions` array (whose
 * text comes from the original tool_use input) so we can correctly tokenize
 * pairs even when answers or notes contain commas.
 */
export function parseAnswerResult(text: string, questions: QuestionLike[]): ParsedAnswer[] | null {
  if (questions.length === 0) return null;
  const envelopeBody = matchEnvelope(text);
  if (envelopeBody === null) return null;
  let body = envelopeBody;

  const result: ParsedAnswer[] = [];
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i]!.question;
    const anchor = `"${escapeQuote(question)}"=`;
    if (!body.startsWith(anchor)) return null;
    let cursor = anchor.length;
    const answerEnd = findClosingQuote(body, cursor + 1);
    if (answerEnd < 0) return null;
    const answer = unescapeQuote(body.slice(cursor + 1, answerEnd));
    cursor = answerEnd + 1;

    // Find where this question's segment ends. The next question's anchor
    // (after a ", " separator) is the boundary; otherwise the segment runs
    // to the end of the body.
    let segmentEnd = body.length;
    if (i + 1 < questions.length) {
      const nextAnchor = `${PAIR_SEPARATOR}"${escapeQuote(questions[i + 1]!.question)}"=`;
      const nextIdx = body.indexOf(nextAnchor, cursor);
      if (nextIdx < 0) return null;
      segmentEnd = nextIdx;
    }

    const notes = extractNotes(body.slice(cursor, segmentEnd));

    result.push({ question, answer, notes });
    body = body.slice(segmentEnd + (i + 1 < questions.length ? PAIR_SEPARATOR.length : 0));
  }
  if (body.length !== 0) return null;
  return result;
}

/**
 * Strip whichever known envelope wraps the result text, returning the inner
 * question/answer body. Returns null when no envelope matches.
 */
function matchEnvelope(text: string): string | null {
  for (const envelope of ENVELOPES) {
    if (!text.startsWith(envelope.prefix)) continue;
    const suffixStart = text.lastIndexOf(envelope.suffix);
    if (suffixStart < envelope.prefix.length) continue;
    return text.slice(envelope.prefix.length, suffixStart);
  }
  return null;
}

/**
 * Extract user notes from the annotation remainder between an answer value and
 * the next question separator. The remainder can contain multiple annotation
 * markers (e.g. ` user notes: ...`, ` selected preview:\n...`). We extract
 * the notes value and ignore other annotations.
 */
function extractNotes(remainder: string): string | null {
  if (remainder.length === 0) return null;
  const notesStart = remainder.indexOf(NOTES_MARKER);
  if (notesStart < 0) return null;
  const notesContent = remainder.slice(notesStart + NOTES_MARKER.length);
  const previewIndex = notesContent.indexOf(PREVIEW_MARKER);
  if (previewIndex >= 0) {
    return notesContent.slice(0, previewIndex);
  }
  return notesContent;
}

function findClosingQuote(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (text[i] === '"') return i;
    i++;
  }
  return -1;
}

function unescapeQuote(value: string): string {
  return value.replace(/\\"/g, '"');
}
