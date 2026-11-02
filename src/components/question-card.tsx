import {Check, ChevronLeft, ChevronRight} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {flushSync} from "react-dom";

import {acknowledgeApproval} from "../lib/answered-approvals";
import {holdAnswered, releaseAnswered} from "../lib/answered-sessions";
import {APPROVAL_ARM_GRACE_MS, approvalHotkeyFocusAllowed, onScreen} from "../lib/dock-keys";
import type {QuestionAnswer} from "../lib/hook-events";
import {OUTCOME_LABEL, type QuestionLike} from "../lib/ask-user-question";
import {
	clearQuestionCardState,
	clearSentQuestionCard,
	markQuestionCardSeen,
	markQuestionCardSent,
	readQuestionCardState,
	readSentQuestionCard,
	subscribeSentQuestionCard,
	wasQuestionCardSeen,
	writeQuestionCardState,
} from "../lib/question-card-store";
import {chooseOther, labelledAnswers, pickOption, type QuestionCardDraft, typeOther} from "../lib/question-card-draft";
import {ApprovalActionButton} from "./approval-card";
import {QuestionReceipt, type QuestionReceiptRow} from "./question-receipt";
import {ReadOnlyAnswerHint} from "./terminal-writes-tip";
import {Shortcut} from "./ui/shortcut";
import {DisabledReason} from "./ui/disabled-reason";
import {UserInlineText} from "./user-plain-text";

/** Upstream sends an Other picked with nothing typed as this. */
const EMPTY_OTHER = "Something else";

/** Upstream's `@container (width <= 420px)` stack for the card's action row. */
const STACK_ACTIONS = "@max-[420px]:flex-col @max-[420px]:items-stretch @max-[420px]:[&>*]:w-full";

/** Upstream opens a single-select question on its first option. */
function initialDraft(question: QuestionLike): QuestionCardDraft {
	const preselect = question.multiSelect !== true && question.options.length > 0;
	return {selected: preselect ? [0] : [], other: "", otherChosen: false};
}

function isAnswered(draft: QuestionCardDraft): boolean {
	return draft.selected.length > 0 || draft.otherChosen;
}

function answerOf(draft: QuestionCardDraft): QuestionAnswer {
	const selected = draft.selected.toSorted((a, b) => a - b);
	if (!draft.otherChosen) return {selected};
	const other = draft.other.trim();
	return {selected, other: other === "" ? EMPTY_OTHER : other};
}

/** The receipt rows of a submitted card: each picked answer as upstream builds it, or Skipped. */
function sentReceiptRows(
	questions: readonly QuestionLike[],
	drafts: readonly QuestionCardDraft[],
	skipped: readonly boolean[],
): QuestionReceiptRow[] {
	const answers = drafts.map((entry, at) => (skipped[at] === true ? null : answerOf(entry)));
	return labelledAnswers(questions, answers).map(({question, answer}, at) => ({
		question,
		answer: answers[at] === null ? OUTCOME_LABEL.skipped : answer,
		notes: null,
	}));
}

function Mark({checked, multi}: {checked: boolean; multi: boolean}) {
	const shape = multi ? "rounded-r3" : "rounded-full";
	return (
		<span
			aria-hidden="true"
			{...(checked ? {"data-checked": ""} : {"data-unchecked": ""})}
			className={`mt-[calc((1lh-1rem)/2)] flex size-4 shrink-0 items-center justify-center ${shape} ${
				checked ? "bg-fill-accent text-white" : "shadow-[inset_0_0_0_1px_var(--upstream-border-strong)]"
			}`}
		>
			{checked &&
				(multi ? (
					<Check className="size-3" strokeWidth={3} />
				) : (
					<span className="size-1.5 rounded-full bg-white" />
				))}
		</span>
	);
}

/** Upstream's `data-question-answer`: every option button and the Other button, the arrow keys' stops. */
const ANSWER_ATTR = "data-question-answer";

/** Upstream's `data-question-answer-row`: an option whose description links, drawn as a row around its button. */
const ANSWER_ROW_ATTR = "data-question-answer-row";

const OPTION_FOCUS = "focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus";

const OPTION_CLASS = "epitaxy-answer-option flex w-full items-start gap-3 px-3 py-3 text-start";

const OPTION_TEXT_CLASS =
	"[unicode-bidi:plaintext] [text-align:-webkit-match-parent] supports-[text-align:match-parent]:[text-align:match-parent]";

/** Upstream's `lt`: a description with a URL is linkified, and its option becomes a row. */
const HAS_URL = /https?:\/\//;

/**
 * Upstream's `st()` on the card root (gated `__gb__725942835`, on upstream):
 * ArrowDown / ArrowUp move focus one stop through the enabled answers, clamped
 * at both ends; from the root they go to the first / last answer (a repeat is
 * swallowed without moving). A link inside an answer row moves from its row.
 * Modified keys and IME composition pass through; the selection never changes.
 */
function roveAnswers(event: ReactKeyboardEvent<HTMLDivElement>) {
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
	if (!onRoot) {
		stops[at + step]?.focus({focusVisible: true});
		return;
	}
	if (!event.repeat) stops.at(step === 1 ? 0 : -1)?.focus({focusVisible: true});
}

/** Upstream's `dt()`: the click landed in the row and not on a link or another button inside it. */
function clickPicksRow(event: MouseEvent<HTMLElement>): boolean {
	const target = event.target instanceof Element ? event.target : null;
	const control = target?.closest("a, button");
	return (
		target !== null &&
		event.currentTarget.contains(target) &&
		(control === null || control === undefined || control.hasAttribute(ANSWER_ATTR))
	);
}

/** Upstream's onMouseDown preventDefault: clicking a card button never moves focus. */
function keepFocus(event: MouseEvent) {
	event.preventDefault();
}

/** Upstream's gt(): a click that ends a drag-select within its own row is a selection, not a pick. */
function selectionInside(event: MouseEvent<HTMLElement>): boolean {
	const selection = event.currentTarget.ownerDocument.getSelection();
	return (
		selection !== null &&
		!selection.isCollapsed &&
		selection.rangeCount > 0 &&
		selection.getRangeAt(0).intersectsNode(event.currentTarget)
	);
}

/**
 * Upstream's shared approval hotkey: a window capture-phase ⌘⏎ / Ctrl+⏎ that
 * runs `hotkeyRef.current` with focus in the card, on the body, or in the
 * session composer. It yields (the key passes on) while the card can't advance
 * (`hotkeyRef.current` is null), with ⌥ held, during IME composition, while the
 * card is off-screen, or with focus elsewhere or a composer popup open. It
 * swallows the key without acting on repeat, within the arm grace, and with ⇧
 * (upstream's persistent allow, which questions don't have).
 */
function useApprovalHotkey(cardRootRef: RefObject<HTMLDivElement | null>, hotkeyRef: RefObject<(() => void) | null>) {
	useEffect(() => {
		const armedAt = performance.now();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
			const card = cardRootRef.current;
			const run = hotkeyRef.current;
			if (card === null || run === null) return;
			if (event.altKey || event.isComposing) return;
			if (!approvalHotkeyFocusAllowed(card) || !onScreen(card)) return;
			event.preventDefault();
			event.stopPropagation();
			if (event.repeat || event.shiftKey || performance.now() - armedAt < APPROVAL_ARM_GRACE_MS) return;
			run();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [cardRootRef, hotkeyRef]);
}

/**
 * Upstream's seen-map filler: records `draftKey` once the card intersects the
 * viewport, or at once where IntersectionObserver is unavailable.
 */
function useMarkSeen(cardRootRef: RefObject<HTMLDivElement | null>, draftKey: string | undefined) {
	useEffect(() => {
		const card = cardRootRef.current;
		if (draftKey === undefined || card === null) return undefined;
		if (typeof IntersectionObserver === "undefined") {
			markQuestionCardSeen(draftKey);
			return undefined;
		}
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			markQuestionCardSeen(draftKey);
			observer.disconnect();
		});
		observer.observe(card);
		return () => {
			observer.disconnect();
		};
	}, [cardRootRef, draftKey]);
}

/**
 * One option of upstream's card (`R`): its mark, then the label over a pre-wrap
 * description. A description with a URL is linkified, and the option becomes a
 * `data-question-answer-row` around an inset button labelled by its text, so a
 * link click opens the link instead of picking the option.
 */
function AnswerOption({
	label,
	description,
	checked,
	multi,
	disabled,
	onPick,
}: {
	label: string;
	description: string;
	checked: boolean;
	multi: boolean;
	disabled: boolean;
	onPick: () => void;
}) {
	const textId = useId();
	const pressStartedOnControl = useRef(false);
	const linked = HAS_URL.test(description);
	const text = (
		<div id={textId} className="relative flex min-w-0 flex-1 flex-col gap-1.5 select-text">
			<span className={`text-body text-primary ${OPTION_TEXT_CLASS}`}>{label}</span>
			{description !== "" && (
				<span className={`whitespace-pre-wrap text-body text-secondary ${OPTION_TEXT_CLASS}`}>
					{linked ? <UserInlineText text={description} codeSpans={false} /> : description}
				</span>
			)}
		</div>
	);
	const content = (
		<>
			<Mark checked={checked} multi={multi} />
			{text}
		</>
	);
	if (!linked) {
		return (
			<button
				type="button"
				{...{[ANSWER_ATTR]: ""}}
				aria-pressed={checked}
				disabled={disabled}
				onClick={(event) => {
					if (selectionInside(event)) return;
					onPick();
				}}
				className={`${OPTION_CLASS} cursor-pointer ${OPTION_FOCUS} disabled:cursor-default`}
			>
				{content}
			</button>
		);
	}
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream's row: the inset button takes the keys, the row takes clicks on its text
		<div
			role="presentation"
			{...{[ANSWER_ROW_ATTR]: ""}}
			onMouseDown={(event) => {
				pressStartedOnControl.current = !clickPicksRow(event);
			}}
			onClick={(event) => {
				const fromControl = event.detail !== 0 && pressStartedOnControl.current;
				pressStartedOnControl.current = false;
				if (disabled || fromControl || !clickPicksRow(event) || selectionInside(event)) return;
				onPick();
			}}
			className={`relative ${disabled ? "cursor-default" : "cursor-pointer"} ${OPTION_CLASS}`}
		>
			<button
				type="button"
				{...{[ANSWER_ATTR]: ""}}
				aria-pressed={checked}
				aria-labelledby={textId}
				disabled={disabled}
				className={`absolute inset-0 rounded-[inherit] ${OPTION_FOCUS}`}
			/>
			{content}
		</div>
	);
}

/**
 * Upstream's pending AskUserQuestion card, drawn inline at most 480px wide: the
 * question in a grey header with an "N of M" pager, radio (or checkbox) rows of
 * label and description split by hairlines, an Other row that reveals its text
 * box once chosen, and Skip beside Next / Submit (⌘⏎). With `onSubmit` it
 * answers one answer per question, null for a skipped one; without it every
 * control is disabled. With `draftKey` (upstream's `tool.draftKey ?? tool.id`) the
 * picks, skips and page survive a remount until the card submits. Submitting
 * swaps the card for a receipt of its answers at once, which a remount redraws
 * while the answer is sending; a failed send brings the card back. With
 * `answered` it draws the recorded answers' receipt in the sent receipt's place,
 * so the result keeps that node and its single fade.
 */
export function QuestionCard({
	questions,
	onSubmit,
	submitLabel = "Submit",
	draftKey,
	answered,
	sessionId,
}: {
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
}) {
	const [wasSent] = useState(() =>
		draftKey === undefined ? null : readSentQuestionCard(draftKey, questions.length),
	);
	const [restored] = useState(() =>
		draftKey === undefined ? null : (wasSent ?? readQuestionCardState(draftKey, questions.length)),
	);
	// Upstream fades only a card never seen in this page and never restored.
	const [skipEnter] = useState(() => restored !== null || (draftKey !== undefined && wasQuestionCardSeen(draftKey)));
	const [page, setPage] = useState(restored?.page ?? 0);
	const [drafts, setDrafts] = useState<QuestionCardDraft[]>(() => restored?.drafts ?? questions.map(initialDraft));
	const [skipped, setSkipped] = useState<boolean[]>(() => restored?.skipped ?? questions.map(() => false));
	const [sending, setSending] = useState(wasSent !== null);
	// The sent receipt fades in only when this instance submitted; a remount mid-send redraws it still.
	const [receiptEnters, setReceiptEnters] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const otherRef = useRef<HTMLTextAreaElement>(null);
	const cardRootRef = useRef<HTMLDivElement>(null);
	const hotkeyRef = useRef<(() => void) | null>(null);
	const refocusRef = useRef(false);
	useApprovalHotkey(cardRootRef, hotkeyRef);
	useMarkSeen(cardRootRef, draftKey);
	// Upstream saves the draft on every change and stops once the card has submitted.
	const savedRef = useRef<{mounted: boolean; submitted: boolean}>({mounted: false, submitted: wasSent !== null});
	useEffect(() => {
		if (!savedRef.current.mounted) {
			savedRef.current.mounted = true;
			return;
		}
		if (draftKey === undefined || savedRef.current.submitted) return;
		writeQuestionCardState(draftKey, {page, drafts, skipped});
	}, [draftKey, page, drafts, skipped]);
	// A card remounted mid-send hears when the sending instance's send fails,
	// and turns back into the restored, editable draft with the error.
	useEffect(() => {
		if (draftKey === undefined || wasSent === null) return undefined;
		return subscribeSentQuestionCard(draftKey, (failure) => {
			if (failure === null) return;
			savedRef.current.submitted = false;
			setError(failure);
			setSending(false);
		});
	}, [draftKey, wasSent]);
	const index = Math.min(page, questions.length - 1);
	// Upstream refocuses the card root after a page change that started with focus inside it.
	useEffect(() => {
		if (!refocusRef.current) return;
		refocusRef.current = false;
		cardRootRef.current?.focus({preventScroll: true});
	}, [index]);
	const question = questions[index];
	const draft = drafts[index];
	if (question === undefined || draft === undefined) return null;
	if (answered !== undefined) return <QuestionReceipt rows={answered} enters={false} />;
	// The answered card leaves at once for the receipt of what it sent, which
	// stays through remounts until the result lands; a failed send brings the card back.
	if (sending) return <QuestionReceipt rows={sentReceiptRows(questions, drafts, skipped)} enters={receiptEnters} />;
	const editable = onSubmit !== undefined;
	const multi = question.multiSelect === true;
	const isLast = index === questions.length - 1;
	const settled = (at: number) => skipped[at] === true || isAnswered(drafts[at] ?? initialDraft(question));
	const unanswered = questions.findIndex((_, at) => !settled(at));
	const canAdvance = isLast ? unanswered === -1 : isAnswered(draft);
	// Upstream's disabledReason for the primary button: the current page first,
	// then the first other page still waiting.
	const otherUnanswered = questions.findIndex((_, at) => at !== index && !settled(at));
	const disabledReason =
		!editable || canAdvance
			? null
			: isAnswered(draft)
				? `Question ${otherUnanswered + 1} is unanswered`
				: "Choose an option or skip this question";

	const goTo = (next: number) => {
		refocusRef.current = cardRootRef.current?.contains(document.activeElement) === true;
		setPage(next);
	};

	const update = (next: QuestionCardDraft) => {
		setDrafts((current) => current.map((entry, at) => (at === index ? next : entry)));
		setSkipped((current) => current.map((entry, at) => (at === index ? false : entry)));
	};

	const submit = async (finalDrafts: QuestionCardDraft[], finalSkipped: boolean[]) => {
		if (onSubmit === undefined) return;
		setError(null);
		setSending(true);
		setReceiptEnters(true);
		savedRef.current.submitted = true;
		if (draftKey !== undefined) {
			clearQuestionCardState(draftKey);
			markQuestionCardSent(draftKey, {page, drafts: finalDrafts, skipped: finalSkipped}, sessionId);
			if (sessionId !== undefined) holdAnswered(sessionId, draftKey);
		}
		try {
			await onSubmit(finalDrafts.map((entry, at) => (finalSkipped[at] === true ? null : answerOf(entry))));
			// Upstream's C1: a delivered live answer stays answered through a reload for 5 minutes.
			if (draftKey !== undefined && sessionId !== undefined)
				acknowledgeApproval(sessionId, draftKey, "AskUserQuestion");
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to send the answer";
			savedRef.current.submitted = false;
			if (draftKey !== undefined) {
				writeQuestionCardState(draftKey, {page, drafts: finalDrafts, skipped: finalSkipped});
				clearSentQuestionCard(draftKey, message);
			}
			if (sessionId !== undefined) releaseAnswered(sessionId);
			setError(message);
			setSending(false);
		}
	};

	const advance = () => {
		if (!editable || !canAdvance) return;
		if (isLast) void submit(drafts, skipped);
		else goTo(index + 1);
	};

	const skip = () => {
		if (!editable) return;
		const nextSkipped = skipped.map((entry, at) => (at === index ? true : entry));
		const nextDrafts = drafts.map((entry, at) =>
			at === index ? {selected: [], other: "", otherChosen: false} : entry,
		);
		setSkipped(nextSkipped);
		setDrafts(nextDrafts);
		// Upstream's Skip always moves to the next page; only the last page looks back or submits.
		if (!isLast) {
			goTo(index + 1);
			return;
		}
		const remaining = questions.findIndex(
			(_, at) => nextSkipped[at] !== true && !isAnswered(nextDrafts[at] ?? initialDraft(question)),
		);
		if (remaining === -1) {
			if (otherRef.current !== null && document.activeElement === otherRef.current) {
				cardRootRef.current?.focus({preventScroll: true});
			}
			void submit(nextDrafts, nextSkipped);
		} else goTo(remaining);
	};

	hotkeyRef.current = editable && canAdvance ? advance : null;
	const primary = (
		<ApprovalActionButton
			variant="primary"
			disabled={!editable || !canAdvance}
			onMouseDown={keepFocus}
			onClick={advance}
		>
			{isLast ? submitLabel : "Next"}
			<Shortcut keys="cmd+enter" className="pointer-coarse:hidden" />
		</ApprovalActionButton>
	);

	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- only keeps clicks inside the card from reaching transcript row handlers, as upstream
		<div
			ref={cardRootRef}
			role="group"
			tabIndex={-1}
			aria-label={question.question}
			data-approval-card-root=""
			data-focus-region="question"
			data-approval-presentation="card"
			onClick={(event) => {
				event.stopPropagation();
			}}
			onKeyDown={roveAnswers}
			{...(skipEnter ? {"data-skip-approval-enter": ""} : {})}
			className={`card-ring @container relative isolate flex max-w-[480px] flex-col overflow-clip rounded-r7 outline-none${
				skipEnter ? "" : " animate-approval-inline-enter motion-reduce:animate-none"
			}`}
		>
			<div className="flex items-center gap-3 bg-alpha-1 px-3 py-2">
				<div className="min-w-0 flex-1 text-body text-primary select-text break-words [unicode-bidi:plaintext]">
					<UserInlineText text={question.question} codeSpans={false} />
				</div>
				{questions.length > 1 && (
					<span className="-my-1.5 -me-2 flex shrink-0 items-center gap-1.5 text-caption text-ink-muted">
						<button
							type="button"
							aria-label="Show previous question"
							disabled={index === 0}
							onMouseDown={(event) => {
								event.preventDefault();
							}}
							onClick={() => {
								goTo(index - 1);
							}}
							className="flex size-5 cursor-pointer items-center justify-center rounded-r5 hover:bg-fill-ghost-hover disabled:cursor-default disabled:opacity-50"
						>
							<ChevronLeft aria-hidden="true" className="size-4" />
						</button>
						<span className="tabular-nums">
							{index + 1} of {questions.length}
						</span>
						<button
							type="button"
							aria-label="Show next question"
							disabled={isLast}
							onMouseDown={(event) => {
								event.preventDefault();
							}}
							onClick={() => {
								goTo(index + 1);
							}}
							className="flex size-5 cursor-pointer items-center justify-center rounded-r5 hover:bg-fill-ghost-hover disabled:cursor-default disabled:opacity-50"
						>
							<ChevronRight aria-hidden="true" className="size-4" />
						</button>
					</span>
				)}
			</div>
			<span className="contents" data-approval-allow="">
				<div className="flex flex-col divide-y divide-[var(--card-outline)]">
					{question.options.map((option, optionIndex) => (
						<AnswerOption
							key={`${optionIndex}-${option.label}`}
							label={option.label}
							description={option.description ?? ""}
							checked={draft.selected.includes(optionIndex)}
							multi={multi}
							disabled={!editable}
							onPick={() => {
								update(pickOption(question, draft, optionIndex));
							}}
						/>
					))}
					<div className="epitaxy-answer-option relative grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 px-3 py-3">
						<button
							type="button"
							{...{[ANSWER_ATTR]: ""}}
							aria-label="Other"
							aria-pressed={draft.otherChosen}
							disabled={!editable}
							onClick={(event) => {
								if (selectionInside(event)) return;
								// Upstream commits the pick synchronously so the revealed box exists to focus.
								flushSync(() => {
									update(chooseOther(question, draft));
								});
								otherRef.current?.focus();
							}}
							className="absolute inset-0 cursor-pointer outline-none hide-focus-ring focus-visible:ring-focus disabled:cursor-default"
						/>
						<span aria-hidden="true" className="contents">
							<Mark checked={draft.otherChosen} multi={multi} />
							<span className="text-body text-primary">Other</span>
						</span>
						{draft.otherChosen && (
							<textarea
								ref={otherRef}
								aria-label="Other option"
								dir="auto"
								placeholder="Type your own answer here"
								rows={1}
								value={draft.other}
								disabled={!editable}
								onChange={(event) => {
									update(typeOther(question, draft, event.target.value));
								}}
								onKeyDown={(event) => {
									// Upstream's ct(): Escape hands focus back to the card, keeping the text.
									if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
									event.preventDefault();
									cardRootRef.current?.focus({preventScroll: true});
								}}
								className="relative z-[1] col-start-2 row-start-2 min-h-[calc(1lh+0.75rem)] max-h-[calc(4lh+0.75rem)] w-full resize-none rounded-r5 bg-fill-field px-2 py-1.5 font-sans text-[13px]/[19px] text-primary outline-none [field-sizing:content] placeholder:text-ink-muted shadow-field-ring transition duration-150 hover:shadow-field-hover focus-visible:shadow-focus disabled:opacity-50"
							/>
						)}
					</div>
				</div>
			</span>
			{multi && (
				<span role="status" data-find-omitted="" className="sr-only select-none">
					{draft.selected.length + (draft.otherChosen ? 1 : 0)} selected
				</span>
			)}
			{error !== null && <p className="px-3 pt-2 text-footnote text-danger-ink">{error}</p>}
			{onSubmit === undefined && <ReadOnlyAnswerHint className="px-3 pt-2 text-footnote text-secondary" />}
			<div
				className={`epitaxy-approval-actions flex items-center justify-end gap-2 px-3 pt-2 pb-3 ${STACK_ACTIONS}`}
			>
				<ApprovalActionButton variant="secondary" disabled={!editable} onMouseDown={keepFocus} onClick={skip}>
					Skip
				</ApprovalActionButton>
				<DisabledReason reason={disabledReason}>{primary}</DisabledReason>
			</div>
		</div>
	);
}
