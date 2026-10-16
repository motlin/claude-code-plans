import type {PendingApprovalItem} from "./api/approvals";
import type {PendingQuestion, PendingQuestionItem} from "./hook-events";
import {pluralize} from "./pluralize";

/** Upstream's 280-code-point cap on the hover card's question and plan text. */
export const AWAITING_TEXT_CAP = 280;

/** Unsent quick replies survive closing the card for ten minutes, as upstream. */
export const QUICK_REPLY_DRAFT_TTL_MS = 10 * 60 * 1000;

/** What a Needs input session waits on, as the sidebar hover card shows it. */
export type AwaitingGate =
	| {
			kind: "question";
			toolUseId: string;
			questions: PendingQuestionItem[];
			/** Hook-reported, so the live pane can be answered; a transcript-only question cannot. */
			answerable: boolean;
	  }
	| {kind: "plan"; planFilename: string | null}
	| {kind: "permission"; message: string}
	| {kind: "none"};

export function resolveAwaitingGate({
	pendingQuestion,
	approval,
	permission,
}: {
	pendingQuestion: PendingQuestion | null;
	approval:
		| Pick<PendingApprovalItem, "toolName" | "toolUseId" | "planFilename" | "questionPreview" | "questionOptions">
		| undefined;
	/** The session's pending `permission_prompt` notification message. */
	permission: string | null;
}): AwaitingGate {
	if (pendingQuestion !== null) {
		return {
			kind: "question",
			toolUseId: pendingQuestion.toolUseId,
			questions: pendingQuestion.questions,
			answerable: true,
		};
	}
	if (approval?.toolName === "AskUserQuestion" && approval.questionPreview !== null) {
		return {
			kind: "question",
			toolUseId: approval.toolUseId,
			questions: [
				{question: approval.questionPreview, options: approval.questionOptions.map((label) => ({label}))},
			],
			answerable: false,
		};
	}
	if (approval?.toolName === "ExitPlanMode") return {kind: "plan", planFilename: approval.planFilename};
	if (permission !== null) return {kind: "permission", message: permission};
	return {kind: "none"};
}

export function truncateCodePoints(text: string, cap: number): string {
	const points = Array.from(text);
	return points.length > cap ? `${points.slice(0, cap).join("")}…` : text;
}

function questionLines(question: PendingQuestionItem): string {
	return question.question
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.join("\n");
}

/** Every question's text, lines trimmed and blanks dropped, joined with newlines. */
export function questionsText(questions: readonly PendingQuestionItem[]): string {
	return questions
		.map(questionLines)
		.filter((text) => text !== "")
		.join("\n");
}

export function questionCount(questions: readonly PendingQuestionItem[]): number {
	return questions.filter((question) => questionLines(question) !== "").length;
}

/** Upstream's quick reply rule: exactly one question, and not multi-select. */
export function isQuickReplyQuestion(questions: readonly PendingQuestionItem[]): boolean {
	return questions.length === 1 && questions[0]?.multiSelect !== true;
}

export function openToAnswerLabel(count: number): string {
	return `${count} ${pluralize(count, "question")} — open to answer`;
}

const drafts = new Map<string, {text: string; expiresAt: number}>();

/** Drafts are keyed by session and question, so a new question starts empty. */
export function quickReplyDraftKey(sessionId: string, summaryText: string): string {
	return `${sessionId}\n${summaryText}`;
}

export function readQuickReplyDraft(key: string, now: number): string {
	const draft = drafts.get(key);
	if (draft === undefined) return "";
	if (now >= draft.expiresAt) {
		drafts.delete(key);
		return "";
	}
	return draft.text;
}

export function writeQuickReplyDraft(key: string, text: string, now: number): void {
	if (text === "") drafts.delete(key);
	else drafts.set(key, {text, expiresAt: now + QUICK_REPLY_DRAFT_TTL_MS});
}

export function clearQuickReplyDraft(key: string): void {
	drafts.delete(key);
}

/**
 * A chip label without its inline markdown: links keep their text, and
 * emphasis, strikethrough and code markers go. Labels are one line, so this
 * skips the block parser the transcript uses.
 */
export function stripInlineMarkdown(label: string): string {
	return label
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__|~~|`)(.+?)\1/g, "$2")
		.replace(/(^|[^\w*])([*_])(?!\s)(.+?)(?<!\s)\2(?!\w)/g, "$1$3")
		.trim();
}

/**
 * A plan's text under its headline, for the Plan ready card: the leading `#`
 * title goes, and heading, list and inline markers are dropped line by line.
 */
export function planDetail(markdown: string): string {
	const lines = markdown.split("\n");
	const titleIndex = lines.findIndex((line) => line.trim() !== "");
	if (titleIndex !== -1 && /^#\s/.test(lines[titleIndex]?.trim() ?? "")) lines.splice(titleIndex, 1);
	return lines
		.map((line) => stripInlineMarkdown(line.trim().replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, "")))
		.filter((line) => line !== "")
		.join("\n");
}
