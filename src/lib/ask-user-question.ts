/**
 * Helpers for the AskUserQuestion tool flow used by the web viewer when
 * answering a pending prompt in an active session.
 */

import {z} from "zod";
import {QUESTION_DISMISSED_BY_MESSAGE} from "./composer-pending-gate";
import type {ToolResultMeta} from "./tool-labels";
import {parseToolRejection} from "./tool-rejection";

export interface QuestionLike
{
	question: string;
	header?: string | undefined;
	options: Array<
	{
		label: string;
		description?: string | undefined;
		preview?: string | null | undefined;
	}>;
	multiSelect?: boolean | undefined;
}

// Loose, so a question keeps the fields (`preview`, ...) the renderers read beyond these.
const QuestionOptionsSchema = z.array(
	z.looseObject(
		{
			label: z.string(),
			description: z.string().optional(),
			preview: z.union([z.string(), z.null()]).optional(),
		},
	),
);
const QuestionsSchema = z.array(
	z.looseObject(
		{
			question: z.string(),
			header: z.string().optional(),
			options: QuestionOptionsSchema,
			multiSelect: z.boolean().optional(),
		},
	),
);

interface AnswerEntry
{
	question: string;
	response: string | readonly string[];
	preview?: string | undefined;
}

interface Envelope
{
	prefix: string;
	suffix: string;
}

const CURRENT_ENVELOPE: Envelope =
{
	prefix: "Your questions have been answered: ",
	suffix: ". You can now continue with these answers in mind.",
};

/** Wording written by older Claude Code versions, still on disk in old sessions. */
const LEGACY_ENVELOPE: Envelope =
{
	prefix: "User has answered your questions: ",
	suffix: ". You can now continue with the user's answers in mind.",
};

/** Wording written by newer Claude Code versions, which tell the model to heed what the user actually said. */
const READ_CAREFULLY_ENVELOPE: Envelope =
{
	prefix: "The user answered: ",
	suffix: ". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.",
};

const ENVELOPES: readonly Envelope[] = [CURRENT_ENVELOPE, READ_CAREFULLY_ENVELOPE, LEGACY_ENVELOPE];

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
export function formatAnswerPrompt(toolUseId: string, answers: readonly AnswerEntry[]): string
{
	const pieces = answers.map(({question, response, preview}) =>
	{
		const answer = typeof response === "string" ? response : response.join(", ");
		const pair = `"${escapeQuote(question)}"="${escapeQuote(answer)}"`;
		// CLI 2.1.318's tool_result: the pair, then `selected preview:\n<preview>`, joined with a space.
		return preview === undefined ? pair : `${pair}${PREVIEW_PREFIX}${preview}`;
	});
	return [
		`(Answering AskUserQuestion ${toolUseId} from the web viewer.)`,
		`${CURRENT_ENVELOPE.prefix}${pieces.join(", ")}${CURRENT_ENVELOPE.suffix}`,
	].join(" ");
}

function escapeQuote(value: string): string
{
	return value.replace(/"/g, '\\"');
}

/**
 * Normalize the polymorphic AskUserQuestion `tool_use.input` shape into a flat
 * array of questions. Supports both the multi-question form (`questions`) and
 * the older single-question form (`question` + `options`). Returns null when
 * neither form is present (e.g. malformed input).
 */
export function normalizeQuestions(input: Record<string, unknown>): QuestionLike[] | null
{
	const multi = QuestionsSchema.safeParse(input["questions"]);
	if (multi.success && multi.data.length > 0)
	{
		return multi.data;
	}
	const singleQ = typeof input["question"] === "string" ? input["question"] : null;
	const singleOpts = QuestionOptionsSchema.safeParse(input["options"]).data;
	if (singleQ && singleOpts && singleOpts.length > 0)
	{
		const data: QuestionLike =
		{
			question: singleQ,
			options: singleOpts,
		};
		if (typeof input["multiSelect"] === "boolean") data.multiSelect = input["multiSelect"];
		if (typeof input["header"] === "string") data.header = input["header"];
		return [data];
	}
	return null;
}

export interface QuestionDraft
{
	selected: Set<string>;
	otherText: string;
	useOther: boolean;
}

export function makeInitialDraft(): QuestionDraft
{
	return {
		selected: new Set(),
		otherText: "",
		useOther: false,
	};
}

/**
 * Project a draft into the final answer string for a question. Returns null
 * when no answer has been chosen (no selection, or 'Other' selected with empty
 * text). For multiSelect questions, joins selected labels with ', '.
 */
export function answerForQuestion(question: QuestionLike, draft: QuestionDraft): string | null
{
	if (draft.useOther)
	{
		const trimmed = draft.otherText.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	const selected = [...draft.selected];
	if (selected.length === 0) return null;
	if (question.multiSelect) return selected.join(", ");
	return selected[0] ?? null;
}

export interface ParsedAnswer
{
	question: string;
	answer: string;
	notes: string | null;
}

export interface AskUserQuestionStatus
{
	tone: "rejected" | "timeout";
	text: string;
	/** The user's own words, when they dismissed the question with feedback. */
	detail?: string;
}

const TIMEOUT_PREFIX = "No response after 60s";

/**
 * Collapse the two non-answer `AskUserQuestion` outcomes -- the user dismissing
 * the prompt, and the 60s no-response timeout -- to a status line.
 *
 * Both results are boilerplate addressed to the model ("STOP what you are
 * doing", "Proceed using your best judgment"), so only the outcome and any
 * words the user typed while dismissing carry information for a human reading
 * the transcript. Anything else returns null and is left to the caller.
 */
export function describeAskUserQuestionResult(result: string | undefined): AskUserQuestionStatus | null
{
	const trimmed = result?.trim();
	if (!trimmed) return null;

	const rejection = parseToolRejection(trimmed);
	if (rejection)
	{
		const status: AskUserQuestionStatus =
		{
			tone: "rejected",
			text: "Question dismissed",
		};
		if (rejection.feedback) status.detail = rejection.feedback;
		return status;
	}

	if (trimmed.startsWith(TIMEOUT_PREFIX))
	{
		return {
			tone: "timeout",
			text: "No response after 60s",
		};
	}

	return null;
}

/**
 * The answers recorded in the call's structured `toolUseResult`, in question
 * order. Newer results write question and answer text unescaped, so this is
 * the reliable source whenever every question has a recorded answer.
 */
function answersFromResultMeta(meta: ToolResultMeta | undefined, questions: QuestionLike[]): ParsedAnswer[] | null
{
	const answers = meta?.answers;
	if (answers === undefined || questions.length === 0) return null;
	const result: ParsedAnswer[] = [];
	for (const {question} of questions)
	{
		const entry = answers[question];
		if (entry === undefined) return null;
		result.push(
			{
				question,
				answer: entry.answer,
				notes: entry.notes,
			},
		);
	}
	return result;
}

const DISMISSED_ANSWER_PREFIX = "[User dismissed";

/** What a question needs from its call and result to tell whether the user withdrew it. */
export interface AskedCall
{
	input: Record<string, unknown>;
	result?: string | undefined;
	isError?: boolean | undefined;
	stopped?: boolean | undefined;
	denied?: boolean | undefined;
	blocked?: boolean | undefined;
	resultMeta?: ToolResultMeta | undefined;
}

/**
 * Whether the user turned the question away rather than answering it: they
 * rejected or interrupted the call, auto mode blocked it, dismissed the prompt (newer Claude Code
 * records a "[User dismissed — ...]" answer to every question), or the call
 * completed without a single real answer. Upstream draws such a question as a
 * compact "Asked “<header>”" / "Asked N questions" step, not a receipt.
 */
export function isWithdrawnQuestion(call: AskedCall): boolean
{
	if (call.stopped === true || call.denied === true || call.blocked === true) return true;
	const {result} = call;
	if (result === undefined) return false;
	if (parseToolRejection(result.trim()) !== null) return true;
	const questions = normalizeQuestions(call.input);
	if (questions === null) return false;
	const answers = answersFromResultMeta(call.resultMeta, questions) ?? parseAnswerResult(result, questions);
	if (answers?.every((entry) => entry.answer.startsWith(DISMISSED_ANSWER_PREFIX)) === true) return true;
	return call.isError !== true && questionOutcomes(call).every((entry) => entry.answer === undefined);
}

/**
 * The note upstream appends to a completed call nobody answered: the shared
 * outcome's word, "Not answered" when the outcomes differ, or none when any
 * question has no recorded entry at all (the CLI's terminal skip).
 */
export function questionOutcomeNote(call: AskedCall): string | undefined
{
	const outcomes = questionOutcomes(call);
	const kinds = new Set<QuestionOutcome>();
	for (const entry of outcomes)
	{
		if (entry.unanswered === undefined) return undefined;
		kinds.add(entry.unanswered);
	}
	const [kind] = kinds;
	if (kind === undefined) return undefined;
	return kinds.size === 1 ? OUTCOME_LABEL[kind] : OUTCOME_LABEL.dismissed;
}

/** Why a question has no real answer, as upstream classifies its recorded answer text. */
export type QuestionOutcome = "skipped" | "replied" | "dismissed";

/** Upstream's word for each unanswered outcome. */
export const OUTCOME_LABEL =
{
	skipped: "Skipped",
	replied: "Replied in chat",
	dismissed: "Not answered",
} as const;

const SKIPPED_ANSWERS: ReadonlySet<string> = new Set([
	"",
	"[No preference]",
	"The user did not answer this question. Make a reasonable assumption and carry on, but tell the user what assumption you made.",
]);
const DISMISSED_ANSWER = "[User dismissed — do not proceed, wait for next instruction]";

/** Classify a recorded answer as one of upstream's non-answers; a real answer returns undefined. */
export function questionOutcome(answer: string): QuestionOutcome | undefined
{
	if (SKIPPED_ANSWERS.has(answer)) return "skipped";
	if (answer === QUESTION_DISMISSED_BY_MESSAGE) return "replied";
	if (answer === DISMISSED_ANSWER) return "dismissed";
	return undefined;
}

export interface QuestionOutcomeEntry
{
	question: string;
	answer?: string;
	unanswered?: QuestionOutcome;
}

/**
 * Each asked question with its real answer or its non-answer outcome. Answers
 * come from the structured result, else from the result text; a question with
 * no recorded entry carries neither field.
 */
export function questionOutcomes(call: AskedCall): QuestionOutcomeEntry[]
{
	const questions = normalizeQuestions(call.input) ?? [];
	const recorded = new Map<string, string>();
	const metaAnswers = call.resultMeta?.answers;
	if (metaAnswers !== undefined)
	{
		for (const [question, entry] of Object.entries(metaAnswers)) recorded.set(question, entry.answer);
	}
	else if (call.result !== undefined)
	{
		for (const entry of parseAnswerResult(call.result, questions) ?? []) recorded.set(entry.question, entry.answer);
	}
	return questions.map(({question}) =>
	{
		const answer = recorded.get(question);
		if (answer === undefined)
			return {
				question,
			};
		const unanswered = questionOutcome(answer);
		return unanswered === undefined
			?
				{
					question,
					answer,
				}
			:
				{
					question,
					unanswered,
				};
	});
}

/** Older CLIs wrote ` user notes: ` before the preview; since 2.1.232 they write ` notes: ` last. Old form first, so it isn't split at its inner ` notes: `. */
const LEGACY_NOTES_MARKER = " user notes: ";
const NOTES_MARKER = " notes: ";
const PREVIEW_MARKER = " selected preview:";
const PREVIEW_PREFIX = `${PREVIEW_MARKER}\n`;
const PAIR_SEPARATOR = ", ";
/** The CLI's pair for an answer that is only notes: `"Q"=(no option selected)`. */
const NO_OPTION_SELECTED = "(no option selected)";
/** The answer the CLI records in meta for that same notes-only answer (its `XEn`). */
const NOTES_ONLY_ANSWER = "(notes only)";
/** What may follow the closing quote of a raw answer, besides the next pair or the end of the body. */
const ANSWER_TERMINATORS = [PREVIEW_MARKER, LEGACY_NOTES_MARKER, NOTES_MARKER] as const;

interface Anchor
{
	length: number;
	escaped: boolean;
}

/**
 * Parse the canonical AskUserQuestion `tool_result.content` text into a
 * structured list of {question, answer, notes} entries. Returns null when the
 * text does not match the expected envelope, no questions were supplied, or
 * no pair parses.
 *
 * The CLI writes each pair as `"Q"="A"` (or `"Q"=(no option selected)` for a
 * notes-only answer), then ` selected preview:\n<preview>` and ` notes: <notes>`,
 * joined with ", ". Question and answer text is interpolated raw, unescaped;
 * a question with no answer and no notes is omitted. Older CLIs escaped quotes
 * as `\"` and wrote ` user notes: ` before the preview; both forms still parse.
 *
 * Pairs are tokenized against the supplied `questions` (from the tool_use
 * input), so answers and notes may contain commas and quotes.
 */
export function parseAnswerResult(text: string, questions: QuestionLike[]): ParsedAnswer[] | null
{
	if (questions.length === 0) return null;
	const body = matchEnvelope(text);
	if (body === null) return null;

	const result: ParsedAnswer[] = [];
	let cursor = 0;
	let next = 0;
	while (cursor < body.length)
	{
		const found = anchorAt(body, cursor, questions, next);
		if (found === null) return null;
		const {index, anchor} = found;
		const question = questions[index];
		if (question === undefined) return null;
		const later = questions.slice(index + 1);
		const valueStart = cursor + anchor.length;
		const parsed = readAnswer(body, valueStart, anchor.escaped, question, later);
		if (parsed === null) return null;
		const segmentEnd = nextPairStart(body, parsed.end, later);
		const preview = question.options.find((option) => option.label === parsed.answer)?.preview ?? undefined;
		const notes = extractNotes(body.slice(parsed.end, segmentEnd), preview);
		result.push(
			{
				question: question.question,
				answer: parsed.answer,
				notes,
			},
		);
		cursor = segmentEnd < body.length ? segmentEnd + PAIR_SEPARATOR.length : segmentEnd;
		next = index + 1;
	}
	return result.length > 0 ? result : null;
}

/** The first question from `from` on whose anchor (raw, else legacy escaped) starts at `cursor`. */
function anchorAt(
	body: string,
	cursor: number,
	questions: QuestionLike[],
	from: number,
):
{
	index: number;
	anchor: Anchor;
} | null
{
	for (let index = from; index < questions.length; index++)
	{
		const question = questions[index];
		if (question === undefined) continue;
		for (const escaped of [false, true])
		{
			const anchor = anchorText(question.question, escaped);
			if (body.startsWith(anchor, cursor))
				return {
					index,
					anchor:
					{
						length: anchor.length,
						escaped,
					},
				};
		}
	}
	return null;
}

function anchorText(question: string, escaped: boolean): string
{
	return `"${escaped ? escapeQuote(question) : question}"=`;
}

/** Read the answer value at `start`; `end` is just past it. */
function readAnswer(
	body: string,
	start: number,
	escaped: boolean,
	question: QuestionLike,
	later: QuestionLike[],
):
{
	answer: string;
	end: number;
} | null
{
	if (body.startsWith(NO_OPTION_SELECTED, start))
	{
		return {
			answer: NOTES_ONLY_ANSWER,
			end: start + NO_OPTION_SELECTED.length,
		};
	}
	if (body[start] !== '"') return null;
	if (escaped)
	{
		const close = findClosingQuote(body, start + 1);
		if (close < 0) return null;
		return {
			answer: unescapeQuote(body.slice(start + 1, close)),
			end: close + 1,
		};
	}
	const endsAnswer = (close: number) => body[close] === '"' && isAnswerEnd(body, close + 1, later);
	const labels = question.options.map((option) => option.label).toSorted((a, b) => b.length - a.length);
	const label = labels.find(
		(candidate) => endsAnswer(start + 1 + candidate.length) && body.startsWith(candidate, start + 1),
	);
	if (label !== undefined)
		return {
			answer: label,
			end: start + 2 + label.length,
		};
	for (let close = body.indexOf('"', start + 1); close >= 0; close = body.indexOf('"', close + 1))
	{
		if (endsAnswer(close))
			return {
				answer: body.slice(start + 1, close),
				end: close + 1,
			};
	}
	// An annotation this parser doesn't know follows the answer: end at the first quote.
	const close = body.indexOf('"', start + 1);
	return close < 0
		? null
		:
			{
				answer: body.slice(start + 1, close),
				end: close + 1,
			};
}

/** Whether a raw answer's closing quote may sit just before `at`. */
function isAnswerEnd(body: string, at: number, later: QuestionLike[]): boolean
{
	if (at === body.length) return true;
	if (ANSWER_TERMINATORS.some((marker) => body.startsWith(marker, at))) return true;
	return nextPairStart(body, at, later) === at;
}

/** Where the next pair's ", " separator starts at or after `from`: the earliest later question's anchor, raw or escaped. */
function nextPairStart(body: string, from: number, later: QuestionLike[]): number
{
	let earliest = body.length;
	for (const {question} of later)
	{
		for (const escaped of [false, true])
		{
			const index = body.indexOf(`${PAIR_SEPARATOR}${anchorText(question, escaped)}`, from);
			if (index >= 0 && index < earliest) earliest = index;
		}
	}
	return earliest;
}

/**
 * Strip whichever known envelope wraps the result text, returning the inner
 * question/answer body. Returns null when no envelope matches.
 */
function matchEnvelope(text: string): string | null
{
	for (const envelope of ENVELOPES)
	{
		if (!text.startsWith(envelope.prefix)) continue;
		const suffixStart = text.lastIndexOf(envelope.suffix);
		if (suffixStart < envelope.prefix.length) continue;
		return text.slice(envelope.prefix.length, suffixStart);
	}
	return null;
}

/**
 * Extract user notes from the annotations between an answer value and the
 * next pair. New CLIs write ` selected preview:\n<preview>` then ` notes: <notes>`;
 * old CLIs wrote ` user notes: <notes>` then the preview. `preview` is the
 * chosen option's preview, stripped exactly when known; without it, notes
 * follow the last ` notes: `. Other annotations are ignored.
 */
function extractNotes(remainder: string, preview: string | undefined): string | null
{
	if (remainder.startsWith(PREVIEW_MARKER))
	{
		const selected = preview === undefined ? null : `${PREVIEW_PREFIX}${preview}`;
		if (selected !== null && remainder.startsWith(selected))
		{
			const rest = remainder.slice(selected.length);
			return rest.startsWith(NOTES_MARKER) ? rest.slice(NOTES_MARKER.length) : null;
		}
		const notesStart = remainder.lastIndexOf(NOTES_MARKER);
		return notesStart < 0 ? null : remainder.slice(notesStart + NOTES_MARKER.length);
	}
	const legacyStart = remainder.indexOf(LEGACY_NOTES_MARKER);
	const notesStart = remainder.indexOf(NOTES_MARKER);
	if (legacyStart >= 0 && legacyStart <= notesStart)
	{
		const notes = remainder.slice(legacyStart + LEGACY_NOTES_MARKER.length);
		const previewIndex = notes.indexOf(PREVIEW_MARKER);
		return previewIndex >= 0 ? notes.slice(0, previewIndex) : notes;
	}
	return notesStart < 0 ? null : remainder.slice(notesStart + NOTES_MARKER.length);
}

function findClosingQuote(text: string, start: number): number
{
	let i = start;
	while (i < text.length)
	{
		if (text[i] === "\\" && i + 1 < text.length)
		{
			i += 2;
			continue;
		}
		if (text[i] === '"') return i;
		i++;
	}
	return -1;
}

function unescapeQuote(value: string): string
{
	return value.replace(/\\"/g, '"');
}
