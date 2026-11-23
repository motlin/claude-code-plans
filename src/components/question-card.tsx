import
{
	Fragment,
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useSyncExternalStore,
} from "react";
import {flushSync} from "react-dom";

import {APPROVAL_ARM_GRACE_MS, approvalHotkeyFocusAllowed, onScreen} from "../lib/dock-keys";
import {installLandingKeys, landingAllowsPick} from "../lib/approval-slot-landing";
import type {QuestionLike} from "../lib/ask-user-question";
import {renderPreviewMarkdownToHtml} from "../lib/client-markdown";
import
{
	isHtmlPreview,
	type OptionPreview,
	parseOptionPreview,
	previewSanitizerLoaded,
	subscribePreviewSanitizer,
} from "../lib/question-option-preview";
import {chooseOther, pickOption, type QuestionCardDraft, typeOther} from "../lib/question-card-draft";
import {APPROVAL_ACTION_SHORTCUT_CLASS, ApprovalActionButton} from "./approval-action-button";
import {DockedQuestionCard} from "./docked-question-card";
import
{
	ANSWER_ATTR,
	ANSWER_ROW_ATTR,
	clickPicksRow,
	HAS_URL,
	isAnswered,
	keepFocus,
	OPTION_FOCUS,
	OPTION_TEXT_CLASS,
	type QuestionCardProps,
	questionName,
	roveAnswers,
	selectionInside,
	useQuestionAnswering,
} from "./question-card-common";
import {QuestionAnswerMark} from "./question-answer-mark";
import {QuestionReceipt} from "./question-receipt";
import {ReadOnlyAnswerHint} from "./terminal-writes-tip";
import {CDS_BUTTON_DISABLED, CDS_ICON_ONLY_DISABLED} from "./ui/cds-button-disabled";
import {Icon} from "./ui/icon";
import {Shortcut} from "./ui/shortcut";
import {DisabledReason} from "./ui/disabled-reason";
import {UserInlineText} from "./user-plain-text";
import {maskSecrets} from "../lib/secret-mask";
import {revealSpoofing} from "../lib/visible-text";
import {stripMemoryTags} from "../lib/task-checklist";

/** Upstream's `@container (width <= 420px)` stack for the card's action row. */
const STACK_ACTIONS = "@max-[420px]:flex-col @max-[420px]:items-stretch @max-[420px]:[&>*]:w-full";

/** The pager's previous/next arrows: upstream's ghost icon-only `sm` cds Buttons (`h-control aspect-square`), with their disabled look. */
const PAGER_ARROW_CLASS = `flex h-control aspect-square cursor-pointer items-center justify-center rounded-[var(--upstream-radius)] hover:bg-fill-ghost-hover ${CDS_BUTTON_DISABLED} ${CDS_ICON_ONLY_DISABLED}`;

const OPTION_CLASS = "epitaxy-answer-option group flex w-full items-start gap-md px-lg py-lg text-start";

/** Upstream opens a single-select question on its first option. */
function initialDraft(question: QuestionLike): QuestionCardDraft
{
	const preselect = question.multiSelect !== true && question.options.length > 0;
	return {
		selected: preselect ? [0] : [],
		other: "",
		otherChosen: false,
	};
}

/**
 * Upstream's card `onKeyDown` guard: on a card focus landed on, an arrow runs only as a fresh pick, which it marks
 * picked (upstream marks it with the card's digit shortcuts on, as its inline card has them).
 */
function onCardKeyDown(event: ReactKeyboardEvent<HTMLDivElement>)
{
	if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !landingAllowsPick(event.nativeEvent, true)) return;
	roveAnswers(event);
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
function useApprovalHotkey(cardRootRef: RefObject<HTMLDivElement | null>, hotkeyRef: RefObject<(() => void) | null>)
{
	useEffect(() =>
	{
		const armedAt = performance.now();
		// The landing keys go first, so a landed card's ⇧⌘⏎ is theirs to swallow.
		installLandingKeys(window);
		const onKeyDown = (event: KeyboardEvent) =>
		{
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
		return () =>
		{
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [cardRootRef, hotkeyRef]);
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
})
{
	const textId = useId();
	const pressStartedOnControl = useRef(false);
	const linked = HAS_URL.test(description);
	const text = (
		<div id={textId} className="relative flex min-w-0 flex-1 flex-col gap-xs select-text">
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
			<QuestionAnswerMark checked={checked} multi={multi} />
			{text}
		</>
	);
	if (!linked)
	{
		return (
			<button
				type="button"
				{...
				{
					[ANSWER_ATTR]: "",
				}}
				aria-pressed={checked}
				disabled={disabled}
				onClick={(event) =>
				{
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
			{...
			{
				[ANSWER_ROW_ATTR]: "",
			}}
			onMouseDown={(event) =>
			{
				pressStartedOnControl.current = !clickPicksRow(event);
			}}
			onClick={(event) =>
			{
				const fromControl = event.detail !== 0 && pressStartedOnControl.current;
				pressStartedOnControl.current = false;
				if (disabled || fromControl || !clickPicksRow(event) || selectionInside(event)) return;
				onPick();
			}}
			className={`relative ${disabled ? "cursor-default" : "cursor-pointer"} ${OPTION_CLASS}`}
		>
			<button
				type="button"
				{...
				{
					[ANSWER_ATTR]: "",
				}}
				aria-pressed={checked}
				aria-labelledby={textId}
				disabled={disabled}
				className={`absolute inset-0 rounded-[inherit] ${OPTION_FOCUS}`}
			/>
			{content}
		</div>
	);
}

/** Upstream's `jt` then `max-h-[240px] overflow-y-auto pb-lg text-secondary`; `px-lg`/`pb-lg` are 12px here (16px in upstream's comfortable density). */
const PREVIEW_CLASS = "px-lg max-h-[240px] overflow-y-auto pb-lg text-secondary";

function subscribeNever(): () => void
{
	return () =>
	{
	};
}

/**
 * Upstream's `wn` → `mU`: the option's parsed preview. An HTML preview waits for the sanitizer chunk
 * (upstream's preview renderer is lazy and client-only too), so the server draws none.
 */
function useOptionPreview(value: unknown): OptionPreview | undefined
{
	const html = isHtmlPreview(value);
	const ready = useSyncExternalStore(
		html ? subscribePreviewSanitizer : subscribeNever,
		previewSanitizerLoaded,
		() => false,
	);
	// Upstream masks a string preview (`b(wn)`) before parsing it.
	return html && !ready ? undefined : parseOptionPreview(typeof value === "string" ? maskSecrets(value) : value);
}

/** Upstream's `GF`: a text preview as its markdown, an HTML one as sanitized; both a focusable scroll region. */
function OptionPreviewBlock({preview}: {preview: OptionPreview})
{
	// `data-question-option-preview` is a local test hook; upstream's block has no attribute.
	if (preview.kind === "html")
	{
		return (
			<div
				// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's preview is a Tab stop so the keyboard can scroll it
				tabIndex={0}
				data-question-option-preview=""
				className={`${PREVIEW_CLASS} font-sans text-body`}
				dangerouslySetInnerHTML={
				{
					__html: preview.sanitizedHtml,
				}}
			/>
		);
	}
	return (
		<div
			// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's preview is a Tab stop so the keyboard can scroll it
			tabIndex={0}
			data-question-option-preview=""
			className={`${PREVIEW_CLASS} flex flex-col gap-2 font-sans text-body`}
		>
			<div
				className="[&_pre_code]:!whitespace-pre"
				dangerouslySetInnerHTML={
				{
					__html: renderPreviewMarkdownToHtml(preview.text),
				}}
			/>
		</div>
	);
}

/** The pending question card: upstream's inline card (c2f6611a3 `W`), or its docked card (c9ed5627b) above the composer. */
export function QuestionCard(props: QuestionCardProps)
{
	return props.presentation === "dock" ? <DockedQuestionCard {...props} /> : <InlineQuestionCard {...props} />;
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
function InlineQuestionCard({
	questions,
	onSubmit,
	submitLabel = "Submit",
	draftKey,
	answered,
	sessionId,
}: QuestionCardProps)
{
	const otherRef = useRef<HTMLTextAreaElement>(null);
	const cardRootRef = useRef<HTMLDivElement>(null);
	const hotkeyRef = useRef<(() => void) | null>(null);
	const refocusRef = useRef(false);
	useApprovalHotkey(cardRootRef, hotkeyRef);
	const
	{
		skipEnter,
		page,
		setPage,
		drafts,
		setDrafts,
		skipped,
		setSkipped,
		sending,
		receiptEnters,
		error,
		submit,
		sentRows,
	} = useQuestionAnswering(
		{
			questions,
			onSubmit,
			draftKey,
			sessionId,
			cardRootRef,
			initialDraft,
			initialHighlighted: null,
		},
	);
	const index = Math.min(page, questions.length - 1);
	// Upstream refocuses the card root after a page change that started with focus inside it.
	useEffect(() =>
	{
		if (!refocusRef.current) return;
		refocusRef.current = false;
		cardRootRef.current?.focus(
			{
				preventScroll: true,
			},
		);
	}, [index]);
	const question = questions[index];
	const draft = drafts[index];
	// Upstream's `wn`: the preview follows `selected[0]` alone, never on a multi-select question.
	const preview = useOptionPreview(
		question?.multiSelect === true ? undefined : question?.options[draft?.selected[0] ?? -1]?.preview,
	);
	if (question === undefined || draft === undefined) return null;
	// The answered card leaves at once for the receipt of what it sent, which
	// stays through remounts until the result lands; a failed send brings the card back.
	// Upstream holds the receipt in a bare find-omitted div while the send is in
	// flight and drops the marker once the result lands. The keyed wrapper keeps the
	// receipt's node across that change and never reuses the card root's div.
	if (answered !== undefined || sending)
	{
		return (
			<div key="receipt" data-find-omitted={answered === undefined ? "" : undefined} className="contents">
				<QuestionReceipt rows={answered ?? sentRows()} enters={answered === undefined && receiptEnters} />
			</div>
		);
	}
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

	const goTo = (next: number) =>
	{
		refocusRef.current = cardRootRef.current?.contains(document.activeElement) === true;
		setPage(next);
	};

	const update = (next: QuestionCardDraft) =>
	{
		setDrafts((current) => current.map((entry, at) => (at === index ? next : entry)));
		setSkipped((current) => current.map((entry, at) => (at === index ? false : entry)));
	};

	const advance = () =>
	{
		if (!editable || !canAdvance) return;
		if (isLast) void submit(drafts, skipped);
		else goTo(index + 1);
	};

	const skip = () =>
	{
		if (!editable) return;
		const nextSkipped = skipped.map((entry, at) => (at === index ? true : entry));
		const nextDrafts = drafts.map((entry, at) =>
			at === index
				?
					{
						selected: [],
						other: "",
						otherChosen: false,
					}
				: entry,
		);
		setSkipped(nextSkipped);
		setDrafts(nextDrafts);
		// Upstream's Skip always moves to the next page; only the last page looks back or submits.
		if (!isLast)
		{
			goTo(index + 1);
			return;
		}
		const remaining = questions.findIndex(
			(_, at) => nextSkipped[at] !== true && !isAnswered(nextDrafts[at] ?? initialDraft(question)),
		);
		if (remaining === -1)
		{
			if (otherRef.current !== null && document.activeElement === otherRef.current)
			{
				cardRootRef.current?.focus(
					{
						preventScroll: true,
					},
				);
			}
			void submit(nextDrafts, nextSkipped);
		}
		else goTo(remaining);
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
			<Shortcut keys="cmd+enter" className={APPROVAL_ACTION_SHORTCUT_CLASS} />
		</ApprovalActionButton>
	);
	// Upstream's `xt` raw text: the question with its memory tags dropped (`ra`).
	const rawQuestion = stripMemoryTags(question.question);

	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- only keeps clicks inside the card from reaching transcript row handlers, as upstream
		<div
			ref={cardRootRef}
			role="group"
			tabIndex={-1}
			// Upstream's `xt` (2026-11-10) names the card `u9` of the masked name; the header paints the raw text itself.
			aria-label={revealSpoofing(questionName(rawQuestion))}
			data-approval-card-root=""
			data-focus-region="question"
			data-approval-presentation="card"
			onClick={(event) =>
			{
				event.stopPropagation();
			}}
			onKeyDown={onCardKeyDown}
			{...(skipEnter
				?
					{
						"data-skip-approval-enter": "",
					}
				: {})}
			className={`card-ring @container relative isolate flex max-w-[480px] flex-col overflow-clip rounded-card origin-top outline-none${
				skipEnter ? "" : " animate-approval-inline-enter motion-reduce:animate-none"
			}`}
		>
			<div className="bg-alpha-1 px-lg flex gap-md py-md items-center">
				<div className="min-w-0 flex-1 text-body text-primary select-text break-words [unicode-bidi:plaintext]">
					<UserInlineText text={rawQuestion} codeLook="chip" revealCloaks />
				</div>
				{questions.length > 1 && (
					<span className="flex shrink-0 items-center -my-xs -me-sm gap-xs text-caption text-muted-as-secondary">
						<button
							type="button"
							aria-label="Show previous question"
							disabled={index === 0}
							onMouseDown={(event) =>
							{
								event.preventDefault();
							}}
							onClick={() =>
							{
								goTo(index - 1);
							}}
							className={PAGER_ARROW_CLASS}
						>
							<Icon name="CaretLeft" className="size-icon" />
						</button>
						<span className="tabular-nums">
							{index + 1} of {questions.length}
						</span>
						<button
							type="button"
							aria-label="Show next question"
							disabled={isLast}
							onMouseDown={(event) =>
							{
								event.preventDefault();
							}}
							onClick={() =>
							{
								goTo(index + 1);
							}}
							className={PAGER_ARROW_CLASS}
						>
							<Icon name="CaretRight" className="size-icon" />
						</button>
					</span>
				)}
			</div>
			<span className="contents" data-approval-allow="">
				<div className="flex flex-col">
					{question.options.map((option, optionIndex) => (
						<Fragment key={`${optionIndex}-${option.label}`}>
							<AnswerOption
								label={maskSecrets(option.label)}
								description={maskSecrets(option.description ?? "")}
								checked={draft.selected.includes(optionIndex)}
								multi={multi}
								disabled={!editable}
								onPick={() =>
								{
									update(pickOption(question, draft, optionIndex));
								}}
							/>
							{/* Upstream checks only selected[0]; the local draft keeps Other apart. */}
							{preview !== undefined && draft.selected[0] === optionIndex && (
								<OptionPreviewBlock preview={preview} />
							)}
						</Fragment>
					))}
					<div className="epitaxy-answer-option group relative grid grid-cols-[auto_1fr] items-start gap-x-md gap-y-sm px-lg py-lg">
						<button
							type="button"
							{...
							{
								[ANSWER_ATTR]: "",
							}}
							aria-label="Other"
							aria-pressed={draft.otherChosen}
							disabled={!editable}
							onClick={(event) =>
							{
								if (selectionInside(event)) return;
								// Upstream commits the pick synchronously so the revealed box exists to focus.
								flushSync(() =>
								{
									update(chooseOther(question, draft));
								});
								otherRef.current?.focus();
							}}
							className="absolute inset-0 cursor-pointer outline-none hide-focus-ring focus-visible:ring-focus disabled:cursor-default"
						/>
						<span aria-hidden="true" className="contents">
							<QuestionAnswerMark checked={draft.otherChosen} multi={multi} />
							<span className="text-body text-primary">Other</span>
						</span>
						{draft.otherChosen && (
							<textarea
								ref={otherRef}
								aria-label="Other option"
								dir="auto"
								placeholder="Type your own answer here"
								rows={1}
								value={editable ? draft.other : maskSecrets(draft.other)}
								disabled={!editable}
								onChange={(event) =>
								{
									update(typeOther(question, draft, event.target.value));
								}}
								onKeyDown={(event) =>
								{
									// Upstream's ct(): Escape hands focus back to the card, keeping the text.
									if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
									event.preventDefault();
									cardRootRef.current?.focus(
										{
											preventScroll: true,
										},
									);
								}}
								className="relative z-[1] col-start-2 row-start-2 min-h-[calc(1lh+2*var(--cds-pad-sm))] max-h-[calc(4lh+2*var(--cds-pad-sm))] w-full resize-none rounded-[var(--upstream-radius)] bg-fill-field px-md py-sm font-sans text-body text-primary outline-none [field-sizing:content] placeholder:text-ink-muted shadow-field-ring transition duration-150 hover:shadow-field-hover focus-visible:shadow-focus disabled:opacity-50"
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
			{error !== null && <p className="px-lg pt-sm text-footnote text-danger-ink">{error}</p>}
			{onSubmit === undefined && <ReadOnlyAnswerHint className="px-lg pt-sm text-footnote text-secondary" />}
			<div
				className={`epitaxy-approval-actions flex items-center justify-end gap-sm px-lg pb-lg pt-md ${STACK_ACTIONS}`}
			>
				<ApprovalActionButton variant="secondary" disabled={!editable} onMouseDown={keepFocus} onClick={skip}>
					Skip
				</ApprovalActionButton>
				<DisabledReason reason={disabledReason}>{primary}</DisabledReason>
			</div>
		</div>
	);
}
