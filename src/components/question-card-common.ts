import
{
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";

import {acknowledgeApproval} from "../lib/answered-approvals";
import {holdAnswered, releaseAnswered} from "../lib/answered-sessions";
import {landingAllowsPick} from "../lib/approval-slot-landing";
import {OUTCOME_LABEL, questionOutcome, type QuestionLike} from "../lib/ask-user-question";
import type {QuestionAnswer} from "../lib/hook-events";
import {EMPTY_OTHER, labelledAnswers, type QuestionCardDraft} from "../lib/question-card-draft";
import
{
	clearQuestionCardState,
	clearSentQuestionCard,
	markQuestionCardSeen,
	markQuestionCardSent,
	type QuestionCardState,
	readQuestionCardState,
	readSentQuestionCard,
	subscribeSentQuestionCard,
	wasQuestionCardSeen,
	writeQuestionCardState,
} from "../lib/question-card-store";
import {cutUnterminatedPrivateKey, maskSecretsCompact} from "../lib/secret-mask";
import type {ApprovalPresentation} from "../lib/approval-presentation";
import type {QuestionReceiptRow} from "./question-receipt";

/** Upstream's `data-question-answer`: every option button and the Other button, the arrow keys' stops. */
export const ANSWER_ATTR = "data-question-answer";

/** Upstream's `data-question-answer-row`: an option whose description links, drawn as a row around its button. */
export const ANSWER_ROW_ATTR = "data-question-answer-row";

export const OPTION_FOCUS = "focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus";

export const OPTION_TEXT_CLASS =
	"[unicode-bidi:plaintext] [text-align:-webkit-match-parent] supports-[text-align:match-parent]:[text-align:match-parent]";

/** Upstream's `lt`: a description with a URL is linkified, and its option becomes a row. */
export const HAS_URL = /https?:\/\//;

export interface QuestionCardProps
{
	questions: readonly QuestionLike[];
	onSubmit?: ((answers: Array<QuestionAnswer | null>) => Promise<void>) | undefined;
	/** The last page's primary label: "Submit", or the fork route's explicit one. */
	submitLabel?: string;
	/** Where the in-progress answer is kept across remounts; the tool use id. */
	draftKey?: string | undefined;
	/** The call's recorded answers, once its result lands after this card sent them. */
	answered?: readonly QuestionReceiptRow[] | undefined;
	/** The question's session: an answer holds it as answered, so every view draws it working at the click. */
	sessionId?: string | undefined;
	/** Upstream's inline "card" (480px, outlined), or docked above the composer on the sidebar backdrop. */
	presentation?: ApprovalPresentation;
	/** Upstream's `queueDepth`: the other requests pending behind this one, drawn as ghosts while docked. */
	queueDepth?: number;
}

export function isAnswered(draft: QuestionCardDraft): boolean
{
	return draft.selected.length > 0 || draft.otherChosen;
}

function answerOf(draft: QuestionCardDraft): QuestionAnswer
{
	const selected = draft.selected.toSorted((a, b) => a - b);
	if (!draft.otherChosen)
		return {
			selected,
		};
	const other = draft.other.trim();
	return {
		selected,
		other: other === "" ? EMPTY_OTHER : other,
	};
}

/** The receipt rows of a submitted card: each picked answer as upstream builds it, a non-answer as its outcome word. */
function sentReceiptRows(
	questions: readonly QuestionLike[],
	drafts: readonly QuestionCardDraft[],
	skipped: readonly boolean[],
): QuestionReceiptRow[]
{
	const answers = drafts.map((entry, at) => (skipped[at] === true ? null : answerOf(entry)));
	return labelledAnswers(questions, answers).map(({question, answer}, at) =>
	{
		const outcome = answers[at] === null ? "skipped" : questionOutcome(answer);
		return {
			question,
			answer: outcome === undefined ? answer : OUTCOME_LABEL[outcome],
			notes: null,
		};
	});
}

/**
 * Upstream's `st()` on the card root (gated `__gb__725942835`, on upstream):
 * ArrowDown / ArrowUp move focus one stop through the enabled answers, clamped
 * at both ends; from the root they go to the first / last answer (a repeat is
 * swallowed without moving). A link inside an answer row moves from its row.
 * Modified keys and IME composition pass through; the selection never changes.
 * On a card focus landed on, the root branch waits for a fresh pick.
 */
export function roveAnswers(event: ReactKeyboardEvent<HTMLDivElement>)
{
	const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
	if (step === 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
	// oxlint-disable-next-line typescript/no-deprecated -- Safari reports IME keydowns only as keyCode 229, as upstream checks
	if (event.nativeEvent.isComposing || event.keyCode === 229) return;
	const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(`[${ANSWER_ATTR}]:not(:disabled)`));
	const onRoot = event.target === event.currentTarget;
	const target = event.target instanceof Element ? event.target : null;
	const from = target?.matches("a")
		? target.closest(`[${ANSWER_ROW_ATTR}]`)?.querySelector(`[${ANSWER_ATTR}]`)
		: target;
	const at = stops.findIndex((stop) => stop === from);
	if (stops.length === 0 || (!onRoot && at === -1)) return;
	event.preventDefault();
	if (!onRoot)
	{
		stops[at + step]?.focus(
			{
				focusVisible: true,
			},
		);
		return;
	}
	// Upstream's root branch moves only on a pick the landing allows (`d_`): none under 400ms after focus landed here.
	if (!event.repeat && landingAllowsPick(event.nativeEvent, false))
		stops.at(step === 1 ? 0 : -1)?.focus(
			{
				focusVisible: true,
			},
		);
}

/** Upstream's `dt()`: the click landed in the row and not on a link or another button inside it. */
export function clickPicksRow(event: MouseEvent<HTMLElement>): boolean
{
	const target = event.target instanceof Element ? event.target : null;
	const control = target?.closest("a, button");
	return (
		target !== null &&
		event.currentTarget.contains(target) &&
		(control === null || control === undefined || control.hasAttribute(ANSWER_ATTR))
	);
}

/** Upstream's onMouseDown preventDefault: clicking a card button never moves focus. */
export function keepFocus(event: MouseEvent)
{
	event.preventDefault();
}

/** Upstream's gt(): a click that ends a drag-select within its own row is a selection, not a pick. */
export function selectionInside(event: MouseEvent<HTMLElement>): boolean
{
	const selection = event.currentTarget.ownerDocument.getSelection();
	return (
		selection !== null &&
		!selection.isCollapsed &&
		selection.rangeCount > 0 &&
		selection.getRangeAt(0).intersectsNode(event.currentTarget)
	);
}

/**
 * Upstream's question name (c2f6611a3 `xt`'s `name`, 2026-11-10) from the raw text (memory tags dropped by `ra`): secrets collapse to 7 bullets (`nF`), and a
 * name holding an unterminated private key is cut before it (`_h`) with a trailing ellipsis.
 */
export function questionName(raw: string): string
{
	const compact = maskSecretsCompact(raw);
	const cut = cutUnterminatedPrivateKey(compact);
	return cut === compact ? compact : `${cut.trimEnd()} …`;
}

/**
 * Upstream's seen-map filler: records `draftKey` once the card intersects the
 * viewport, or at once where IntersectionObserver is unavailable.
 */
function useMarkSeen(cardRootRef: RefObject<HTMLDivElement | null>, draftKey: string | undefined)
{
	useEffect(() =>
	{
		const card = cardRootRef.current;
		if (draftKey === undefined || card === null) return undefined;
		if (typeof IntersectionObserver === "undefined")
		{
			markQuestionCardSeen(draftKey);
			return undefined;
		}
		const observer = new IntersectionObserver((entries) =>
		{
			if (!entries.some((entry) => entry.isIntersecting)) return;
			markQuestionCardSeen(draftKey);
			observer.disconnect();
		});
		observer.observe(card);
		return () =>
		{
			observer.disconnect();
		};
	}, [cardRootRef, draftKey]);
}

/**
 * The answering state both question cards share: the page, picks, skips and highlight, restored from and saved to
 * the draft store under `draftKey` (so the inline and docked cards read one draft), and the submit that turns the
 * card into the receipt of what it sent until the send lands or fails.
 */
export function useQuestionAnswering({
	questions,
	onSubmit,
	draftKey,
	sessionId,
	cardRootRef,
	initialDraft,
	initialHighlighted,
}: {
	questions: readonly QuestionLike[];
	onSubmit: ((answers: Array<QuestionAnswer | null>) => Promise<void>) | undefined;
	draftKey: string | undefined;
	sessionId: string | undefined;
	cardRootRef: RefObject<HTMLDivElement | null>;
	initialDraft: (question: QuestionLike) => QuestionCardDraft;
	initialHighlighted: number | null;
})
{
	const [wasSent] = useState(() =>
		draftKey === undefined ? null : readSentQuestionCard(draftKey, questions.length),
	);
	const [restored] = useState<QuestionCardState | null>(() =>
		draftKey === undefined ? null : (wasSent ?? readQuestionCardState(draftKey, questions.length)),
	);
	// Upstream fades only a card never seen in this page and never restored.
	const [skipEnter] = useState(() => restored !== null || (draftKey !== undefined && wasQuestionCardSeen(draftKey)));
	const [page, setPage] = useState(restored?.page ?? 0);
	const [drafts, setDrafts] = useState<QuestionCardDraft[]>(() => restored?.drafts ?? questions.map(initialDraft));
	const [skipped, setSkipped] = useState<boolean[]>(() => restored?.skipped ?? questions.map(() => false));
	const [highlighted, setHighlighted] = useState<number | null>(() =>
		restored?.highlighted === undefined ? initialHighlighted : restored.highlighted,
	);
	const [sending, setSending] = useState(wasSent !== null);
	// The sent receipt fades in only when this instance submitted; a remount mid-send redraws it still.
	const [receiptEnters, setReceiptEnters] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useMarkSeen(cardRootRef, draftKey);
	// Upstream saves the draft on every change and stops once the card has submitted.
	const savedRef = useRef(
		{
			mounted: false,
			submitted: wasSent !== null,
		},
	);
	useEffect(() =>
	{
		if (!savedRef.current.mounted)
		{
			savedRef.current.mounted = true;
			return;
		}
		if (draftKey === undefined || savedRef.current.submitted) return;
		writeQuestionCardState(
			draftKey,
			{
				page,
				drafts,
				skipped,
				highlighted,
			},
		);
	}, [draftKey, page, drafts, skipped, highlighted]);
	// A card remounted mid-send hears when the sending instance's send fails,
	// and turns back into the restored, editable draft with the error.
	useEffect(() =>
	{
		if (draftKey === undefined || wasSent === null) return undefined;
		return subscribeSentQuestionCard(draftKey, (failure) =>
		{
			if (failure === null) return;
			savedRef.current.submitted = false;
			setError(failure);
			setSending(false);
		});
	}, [draftKey, wasSent]);

	const submit = async (finalDrafts: QuestionCardDraft[], finalSkipped: boolean[]) =>
	{
		if (onSubmit === undefined) return;
		setError(null);
		setSending(true);
		setReceiptEnters(true);
		setDrafts(finalDrafts);
		setSkipped(finalSkipped);
		savedRef.current.submitted = true;
		if (draftKey !== undefined)
		{
			clearQuestionCardState(draftKey);
			markQuestionCardSent(
				draftKey,
				{
					page,
					drafts: finalDrafts,
					skipped: finalSkipped,
				},
				sessionId,
			);
			if (sessionId !== undefined) holdAnswered(sessionId, draftKey);
		}
		try
		{
			await onSubmit(finalDrafts.map((entry, at) => (finalSkipped[at] === true ? null : answerOf(entry))));
			// Upstream's C1: a delivered live answer stays answered through a reload for 5 minutes.
			if (draftKey !== undefined && sessionId !== undefined)
				acknowledgeApproval(sessionId, draftKey, "AskUserQuestion");
		}
		catch (err)
		{
			const message = err instanceof Error ? err.message : "Failed to send the answer";
			savedRef.current.submitted = false;
			if (draftKey !== undefined)
			{
				writeQuestionCardState(
					draftKey,
					{
						page,
						drafts: finalDrafts,
						skipped: finalSkipped,
					},
				);
				clearSentQuestionCard(draftKey, message);
			}
			if (sessionId !== undefined) releaseAnswered(sessionId);
			setError(message);
			setSending(false);
		}
	};

	return {
		skipEnter,
		page,
		setPage,
		drafts,
		setDrafts,
		skipped,
		setSkipped,
		highlighted,
		setHighlighted,
		sending,
		receiptEnters,
		error,
		submit,
		sentRows: () => sentReceiptRows(questions, drafts, skipped),
	};
}
