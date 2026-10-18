import {Check, ChevronLeft, ChevronRight} from "lucide-react";
import {type MouseEvent, type RefObject, useEffect, useRef, useState} from "react";
import {flushSync} from "react-dom";

import type {QuestionAnswer} from "../lib/hook-events";
import type {QuestionLike} from "../lib/ask-user-question";
import {READ_ONLY_ANSWER_HINT} from "../lib/question-answer-route";
import {clearQuestionCardState, readQuestionCardState, writeQuestionCardState} from "../lib/question-card-store";
import {chooseOther, pickOption, type QuestionCardDraft, typeOther} from "../lib/question-card-draft";
import {ApprovalActionButton} from "./approval-card";
import {Shortcut} from "./ui/shortcut";
import {Tooltip} from "./ui/tooltip";

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

/** Upstream's armGraceMs: a ⌘⏎ this soon after the card mounts is ignored. */
const ARM_GRACE_MS = 400;

/** Whether focus is where upstream's approval hotkey listens: the card, the page body, or the session composer with no popup open. */
function hotkeyFocusAllowed(card: HTMLElement): boolean {
	const active = document.activeElement;
	if (active === null || active === document.body || card.contains(active)) return true;
	return (
		active instanceof HTMLTextAreaElement &&
		active.closest("[data-composer-card]") !== null &&
		!active.hasAttribute("aria-controls")
	);
}

function onScreen(card: HTMLElement): boolean {
	const rect = card.getBoundingClientRect();
	return rect.bottom >= 0 && rect.top <= window.innerHeight;
}

/**
 * Upstream's shared approval hotkey: a window capture-phase ⌘⏎ / Ctrl+⏎ that
 * runs `hotkeyRef.current` with focus in the card, on the body, or in the
 * session composer, and yields while the card is off-screen, during the arm
 * grace, on key repeat, during IME composition, or with a composer popup open.
 */
function useApprovalHotkey(cardRootRef: RefObject<HTMLDivElement | null>, hotkeyRef: RefObject<(() => void) | null>) {
	useEffect(() => {
		const armedAt = performance.now();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
			if (event.repeat || event.isComposing) return;
			const card = cardRootRef.current;
			const run = hotkeyRef.current;
			if (card === null || run === null) return;
			if (performance.now() - armedAt < ARM_GRACE_MS) return;
			if (!hotkeyFocusAllowed(card) || !onScreen(card)) return;
			event.preventDefault();
			event.stopPropagation();
			run();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [cardRootRef, hotkeyRef]);
}

/**
 * Upstream's pending AskUserQuestion card, drawn inline at most 480px wide: the
 * question in a grey header with an "N of M" pager, radio (or checkbox) rows of
 * label and description split by hairlines, an Other row that reveals its text
 * box once chosen, and Skip beside Next / Submit (⌘⏎). With `onSubmit` it
 * answers one answer per question, null for a skipped one; without it every
 * control is disabled. With `draftKey` (upstream's `tool.draftKey ?? tool.id`) the
 * picks, skips and page survive a remount until the card submits.
 */
export function QuestionCard({
	questions,
	onSubmit,
	submitLabel = "Submit",
	draftKey,
}: {
	questions: readonly QuestionLike[];
	onSubmit?: ((answers: Array<QuestionAnswer | null>) => Promise<void>) | undefined;
	/** The last page's primary label: "Submit", or the fork route's explicit one. */
	submitLabel?: string;
	/** Where the in-progress answer is kept across remounts; the tool use id. */
	draftKey?: string | undefined;
}) {
	const [restored] = useState(() =>
		draftKey === undefined ? null : readQuestionCardState(draftKey, questions.length),
	);
	const [page, setPage] = useState(restored?.page ?? 0);
	const [drafts, setDrafts] = useState<QuestionCardDraft[]>(() => restored?.drafts ?? questions.map(initialDraft));
	const [skipped, setSkipped] = useState<boolean[]>(() => restored?.skipped ?? questions.map(() => false));
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const otherRef = useRef<HTMLTextAreaElement>(null);
	const cardRootRef = useRef<HTMLDivElement>(null);
	const hotkeyRef = useRef<(() => void) | null>(null);
	const refocusRef = useRef(false);
	useApprovalHotkey(cardRootRef, hotkeyRef);
	// Upstream saves the draft on every change and stops once the card has submitted.
	const savedRef = useRef<{mounted: boolean; submitted: boolean}>({mounted: false, submitted: false});
	useEffect(() => {
		if (!savedRef.current.mounted) {
			savedRef.current.mounted = true;
			return;
		}
		if (draftKey === undefined || savedRef.current.submitted) return;
		writeQuestionCardState(draftKey, {page, drafts, skipped});
	}, [draftKey, page, drafts, skipped]);
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
	const editable = onSubmit !== undefined && !sending;
	const multi = question.multiSelect === true;
	const isLast = index === questions.length - 1;
	const settled = (at: number) => skipped[at] === true || isAnswered(drafts[at] ?? initialDraft(question));
	const unanswered = questions.findIndex((_, at) => !settled(at));
	const canAdvance = isLast ? unanswered === -1 : isAnswered(draft);
	// Upstream's disabledReason for the primary button.
	const disabledReason =
		!editable || canAdvance
			? null
			: isLast
				? `Question ${unanswered + 1} is unanswered`
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
		savedRef.current.submitted = true;
		if (draftKey !== undefined) clearQuestionCardState(draftKey);
		try {
			await onSubmit(finalDrafts.map((entry, at) => (finalSkipped[at] === true ? null : answerOf(entry))));
		} catch (err) {
			savedRef.current.submitted = false;
			if (draftKey !== undefined)
				writeQuestionCardState(draftKey, {page, drafts: finalDrafts, skipped: finalSkipped});
			setError(err instanceof Error ? err.message : "Failed to send the answer");
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

	hotkeyRef.current = editable ? advance : null;
	const primary = (
		<ApprovalActionButton
			variant="primary"
			busy={sending}
			disabled={!editable || !canAdvance}
			onMouseDown={keepFocus}
			onClick={advance}
		>
			{isLast ? submitLabel : "Next"}
			<Shortcut keys="cmd+enter" className="pointer-coarse:hidden" />
		</ApprovalActionButton>
	);

	return (
		<div
			ref={cardRootRef}
			role="group"
			tabIndex={-1}
			aria-label={question.question}
			data-approval-card-root=""
			data-approval-presentation="card"
			{...(restored === null ? {} : {"data-skip-approval-enter": ""})}
			className={`card-ring @container relative isolate flex max-w-[480px] flex-col overflow-clip rounded-r7 outline-none${
				restored === null ? " animate-approval-inline-enter motion-reduce:animate-none" : ""
			}`}
		>
			<div className="flex items-center gap-3 bg-alpha-1 px-3 py-2">
				<div className="min-w-0 flex-1 text-body text-primary select-text break-words [unicode-bidi:plaintext]">
					{question.question}
				</div>
				{questions.length > 1 && (
					<span className="-my-1.5 -me-2 flex shrink-0 items-center gap-1.5 text-caption text-ink-muted">
						<button
							type="button"
							aria-label="Show previous question"
							disabled={index === 0 || sending}
							onMouseDown={(event) => {
								event.preventDefault();
							}}
							onClick={() => {
								goTo(index - 1);
							}}
							className="flex size-6 cursor-pointer items-center justify-center rounded-r5 hover:bg-fill-ghost-hover disabled:cursor-default disabled:opacity-50"
						>
							<ChevronLeft aria-hidden="true" className="size-4" />
						</button>
						<span className="tabular-nums">
							{index + 1} of {questions.length}
						</span>
						<button
							type="button"
							aria-label="Show next question"
							disabled={isLast || sending}
							onMouseDown={(event) => {
								event.preventDefault();
							}}
							onClick={() => {
								goTo(index + 1);
							}}
							className="flex size-6 cursor-pointer items-center justify-center rounded-r5 hover:bg-fill-ghost-hover disabled:cursor-default disabled:opacity-50"
						>
							<ChevronRight aria-hidden="true" className="size-4" />
						</button>
					</span>
				)}
			</div>
			<div className="flex flex-col divide-y divide-[var(--card-outline)]">
				{question.options.map((option, optionIndex) => {
					const checked = draft.selected.includes(optionIndex);
					return (
						<button
							key={option.label}
							type="button"
							aria-pressed={checked}
							disabled={!editable}
							onClick={(event) => {
								if (selectionInside(event)) return;
								update(pickOption(question, draft, optionIndex));
							}}
							className="epitaxy-answer-option flex w-full cursor-pointer items-start gap-3 px-3 py-3 text-start outline-none hide-focus-ring focus-visible:ring-focus disabled:cursor-default"
						>
							<Mark checked={checked} multi={multi} />
							<div className="flex min-w-0 flex-1 flex-col gap-1.5 select-text">
								<span className="text-body text-primary [unicode-bidi:plaintext]">{option.label}</span>
								{option.description !== undefined && option.description !== "" && (
									<span className="text-body text-secondary">{option.description}</span>
								)}
							</div>
						</button>
					);
				})}
				<div className="epitaxy-answer-option relative grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 px-3 py-3">
					<button
						type="button"
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
							className="relative z-[1] col-start-2 row-start-2 max-h-[calc(4lh+0.75rem)] w-full resize-none rounded-r5 bg-fill-field px-2 py-1.5 font-sans text-body text-primary outline-none [field-sizing:content] placeholder:text-ink-muted shadow-field-ring transition-shadow hover:shadow-field-hover focus-visible:shadow-focus"
						/>
					)}
				</div>
			</div>
			{error !== null && <p className="px-3 pt-2 text-footnote text-danger-ink">{error}</p>}
			{onSubmit === undefined && (
				<p data-approval-read-only="" className="px-3 pt-2 text-footnote text-secondary">
					{READ_ONLY_ANSWER_HINT}
				</p>
			)}
			<div
				className={`epitaxy-approval-actions flex items-center justify-end gap-2 px-3 pt-2 pb-3 ${STACK_ACTIONS}`}
			>
				<ApprovalActionButton variant="secondary" disabled={!editable} onMouseDown={keepFocus} onClick={skip}>
					Skip
				</ApprovalActionButton>
				{disabledReason === null ? (
					primary
				) : (
					<Tooltip content={disabledReason}>
						<span className="flex">{primary}</span>
					</Tooltip>
				)}
			</div>
		</div>
	);
}
