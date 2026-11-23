import
{
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {flushSync} from "react-dom";

import {DISMISSED_ANSWER, type QuestionLike} from "../lib/ask-user-question";
import {hasPreviews, pickDockedOption, type QuestionCardDraft, typeOther} from "../lib/question-card-draft";
import {maskSecrets} from "../lib/secret-mask";
import {stripMemoryTags} from "../lib/task-checklist";
import {ApprovalActionButton} from "./approval-action-button";
import {ApprovalDockBackdrop} from "./approval-card";
import {ApprovalStackGhosts} from "./approval-stack";
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
	roveAnswers,
	selectionInside,
	useQuestionAnswering,
} from "./question-card-common";
import {QuestionAnswerMark} from "./question-answer-mark";
import {QuestionReceipt} from "./question-receipt";
import {ReadOnlyAnswerHint} from "./terminal-writes-tip";
import {CDS_BUTTON_DISABLED, CDS_ICON_ONLY_DISABLED} from "./ui/cds-button-disabled";
import {cdsButtonClass} from "./ui/cds-button";
import * as Collapsible from "./ui/collapsible";
import {Icon} from "./ui/icon";
import {UserInlineText} from "./user-plain-text";

/** The docked card opens with nothing picked: upstream's Rh7 has no preselect. */
function emptyDraft(): QuestionCardDraft
{
	return {
		selected: [],
		other: "",
		otherChosen: false,
	};
}

/** Upstream's Rh7 `I()` on a page change: Other when picked, else the first pick, else row 0 of a previewed question. */
function pageHighlight(question: QuestionLike | undefined, draft: QuestionCardDraft | undefined): number | null
{
	if (draft?.otherChosen === true) return -1;
	const first = draft?.selected.toSorted((a, b) => a - b)[0];
	if (first !== undefined) return first;
	return question !== undefined && hasPreviews(question) ? 0 : null;
}

/** Upstream's three row fills (`Tt`): picked, the highlighted multi-select row, or resting. */
function rowFill(selected: boolean, highlighted: boolean): string
{
	if (selected)
		return "bg-surface-popover dark:bg-alpha-2 [box-shadow:inset_0_0_0_1px_var(--color-fill-secondary-ring)]";
	return highlighted ? "bg-alpha-2" : "bg-alpha-1 hover:bg-alpha-2";
}

const ROW_CLASS = "flex items-center gap-sm rounded-r4 px-md py-md text-start";

/** Upstream's ghost icon-only cds Button (header toggle, dismiss, pager arrows). */
const ICON_BUTTON_CLASS = `${cdsButtonClass("ghost")} aspect-square !px-0 ${CDS_BUTTON_DISABLED} ${CDS_ICON_ONLY_DISABLED}`;

/** Upstream's multi-select row checkbox (`<span data-size="sm"><Checkbox/></span>`). */
function RowCheckbox({checked}: {checked: boolean})
{
	return (
		<span data-size="sm" className="flex shrink-0">
			<QuestionAnswerMark checked={checked} multi />
		</span>
	);
}

/**
 * One option row of upstream's docked card (`gt` with the `Tt` fills): a filled 5px row of label over a footnote
 * description, a trailing checkbox on multi-select. A description with a URL makes the row a
 * `data-question-answer-row` around an inset button, so its links stay clickable.
 */
function DockedOption({
	label,
	description,
	multi,
	selected,
	highlighted,
	disabled,
	onPick,
}: {
	label: string;
	description: string;
	multi: boolean;
	selected: boolean;
	highlighted: boolean;
	disabled: boolean;
	onPick: (event: MouseEvent<HTMLElement>) => void;
})
{
	const textId = useId();
	const linked = HAS_URL.test(description);
	const pressed = multi
		?
			{
				"aria-pressed": selected,
			}
		: {};
	const content = (
		<>
			<div id={textId} className="relative flex min-w-0 flex-1 flex-col select-text gap-0.5">
				<div className={`text-body text-primary ${OPTION_TEXT_CLASS}`}>{label}</div>
				{description !== "" && (
					<div className={`whitespace-pre-wrap text-footnote text-muted-as-secondary ${OPTION_TEXT_CLASS}`}>
						{linked ? <UserInlineText text={description} codeSpans={false} /> : description}
					</div>
				)}
			</div>
			{multi && <RowCheckbox checked={selected} />}
		</>
	);
	const fill = rowFill(selected, multi && highlighted);
	if (!linked)
	{
		return (
			<button
				type="button"
				{...
				{
					[ANSWER_ATTR]: "",
				}}
				{...pressed}
				disabled={disabled}
				onClick={(event) =>
				{
					if (selectionInside(event)) return;
					onPick(event);
				}}
				className={`${ROW_CLASS} ${fill} ${OPTION_FOCUS} cursor-pointer disabled:cursor-default`}
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
			onClick={(event) =>
			{
				if (disabled || !clickPicksRow(event) || selectionInside(event)) return;
				onPick(event);
			}}
			className={`relative ${ROW_CLASS} ${fill} ${disabled ? "cursor-default" : "cursor-pointer"}`}
		>
			<button
				type="button"
				{...
				{
					[ANSWER_ATTR]: "",
				}}
				{...pressed}
				aria-labelledby={textId}
				disabled={disabled}
				className={`absolute inset-0 rounded-[inherit] ${OPTION_FOCUS}`}
			/>
			{content}
		</div>
	);
}

/**
 * Upstream's card pager (c2f6611a3 `Ct` with `compactCount`): ghost arrows around "i of n", which a container under
 * 328px swaps for "i/n". An end arrow stays focusable but inert (`aria-disabled`), named by why it can't move.
 */
function DockedPager({
	position,
	count,
	previous,
	next,
}: {
	position: number;
	count: number;
	previous: PagerStep;
	next: PagerStep;
})
{
	const arrow = (step: PagerStep, glyph: ReactNode) => (
		<button
			type="button"
			{...(step.inert
				?
					{
						"aria-disabled": true,
					}
				: {})}
			aria-label={step.inert ? step.endLabel : step.label}
			onMouseDown={keepFocus}
			onClick={(event) =>
			{
				if (!step.inert) step.onPress(event);
			}}
			className={`${ICON_BUTTON_CLASS}${step.inert ? " epitaxy-card-pager-end" : ""}`}
		>
			<span aria-hidden="true" className={step.inert ? "opacity-disabled" : undefined}>
				{glyph}
			</span>
		</button>
	);
	return (
		<span className="flex shrink-0 items-center me-auto gap-xs text-muted-as-secondary -ms-[8px] @max-[328px]:gap-0">
			{arrow(previous, <Icon name="CaretLeft" className="size-icon" />)}
			<span className="text-caption @max-[328px]:sr-only">
				{position} of {count}
			</span>
			<span aria-hidden="true" className="hidden text-caption tabular-nums @max-[328px]:inline">
				{`${position}/${count}`}
			</span>
			{arrow(next, <Icon name="CaretRight" className="size-icon" />)}
		</span>
	);
}

interface PagerStep
{
	label: string;
	endLabel: string;
	inert: boolean;
	onPress: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Upstream's docked AskUserQuestion card (c9ed5627b `Et`), in the panel-inactive branch claude.ai/code runs: a
 * labelled group root (tab stop -1) whose arrows rove the answers and that swallows Space, a header with the
 * question, a collapse caret and a dismiss X, filled answer rows where a plain single-select answers on one click,
 * an Other row whose box is always drawn, and a compact pager, Skip and Next / Submit with no keycaps. It shares
 * the inline card's draft under `draftKey`, so a presentation switch keeps the picks and page.
 */
export function DockedQuestionCard({
	questions,
	onSubmit,
	submitLabel = "Submit",
	draftKey,
	answered,
	sessionId,
	queueDepth = 0,
}: QuestionCardProps)
{
	const id = useId();
	const titleId = `${id}title`;
	const cardRootRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const otherRef = useRef<HTMLTextAreaElement>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const keyboardPageRef = useRef(false);
	const [collapsed, setCollapsed] = useState(false);
	const
	{
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
		sentRows,
	} = useQuestionAnswering(
		{
			questions,
			onSubmit,
			draftKey,
			sessionId,
			cardRootRef,
			initialDraft: emptyDraft,
			initialHighlighted: pageHighlight(questions[0], undefined),
		},
	);
	const index = Math.min(page, questions.length - 1);
	// Upstream's `kn`: a page change made from the keyboard focuses the new page's first answer; any change scrolls the body to its top.
	useEffect(() =>
	{
		if (bodyRef.current !== null) bodyRef.current.scrollTop = 0;
		if (!keyboardPageRef.current) return undefined;
		keyboardPageRef.current = false;
		const frame = requestAnimationFrame(() =>
		{
			listRef.current?.querySelector<HTMLElement>(`[${ANSWER_ATTR}]`)?.focus(
				{
					preventScroll: true,
					focusVisible: true,
				},
			);
		});
		return () =>
		{
			cancelAnimationFrame(frame);
		};
	}, [index]);
	// Upstream scrolls the highlighted row into view as the highlight moves.
	useEffect(() =>
	{
		if (highlighted === null) return;
		const stops = listRef.current?.querySelectorAll<HTMLElement>(`[${ANSWER_ATTR}]`);
		const row = highlighted === -1 ? stops?.[stops.length - 1] : stops?.[highlighted];
		row?.scrollIntoView(
			{
				block: "nearest",
			},
		);
	}, [highlighted]);
	const question = questions[index];
	const draft = drafts[index];
	if (question === undefined || draft === undefined) return null;
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
	const picked = isAnswered(draft);

	const goTo = (next: number, fromKeyboard: boolean) =>
	{
		keyboardPageRef.current = fromKeyboard;
		setPage(next);
		setHighlighted(pageHighlight(questions[next], drafts[next]));
	};

	/** Upstream's record-and-advance (`L`): the next page, else the first page still open, else submit. */
	const finish = (nextDrafts: QuestionCardDraft[], nextSkipped: boolean[], fromKeyboard: boolean) =>
	{
		if (!isLast)
		{
			goTo(index + 1, fromKeyboard);
			return;
		}
		const open = questions.findIndex(
			(_, at) => nextSkipped[at] !== true && !isAnswered(nextDrafts[at] ?? emptyDraft()),
		);
		if (open === -1) void submit(nextDrafts, nextSkipped);
		else goTo(open, fromKeyboard);
	};

	const pick = (optionIndex: number, event: MouseEvent<HTMLElement>) =>
	{
		const result = pickDockedOption(question, draft, optionIndex);
		const nextDrafts = drafts.map((entry, at) => (at === index ? result.draft : entry));
		const nextSkipped = skipped.map((entry, at) => (at === index ? false : entry));
		// Upstream focuses the Other box once Other is picked, but not when a multi-select unpicks it.
		const focusOther = optionIndex === -1 && result.draft.otherChosen;
		flushSync(() =>
		{
			setDrafts(nextDrafts);
			setSkipped(nextSkipped);
			setHighlighted(result.highlighted);
		});
		if (focusOther) otherRef.current?.focus();
		if (result.answerNow) finish(nextDrafts, nextSkipped, event.detail === 0);
	};

	const advance = (event: MouseEvent<HTMLButtonElement>) =>
	{
		if (!editable || !picked) return;
		finish(drafts, skipped, event.detail === 0);
	};

	const skip = (event: MouseEvent<HTMLButtonElement>) =>
	{
		if (!editable) return;
		const nextSkipped = skipped.map((entry, at) => (at === index ? true : entry));
		const nextDrafts = drafts.map((entry, at) => (at === index ? emptyDraft() : entry));
		setSkipped(nextSkipped);
		setDrafts(nextDrafts);
		finish(nextDrafts, nextSkipped, event.detail === 0);
	};

	const dismiss = () =>
	{
		void submit(
			questions.map(() => (
			{
				selected: [],
				other: DISMISSED_ANSWER,
				otherChosen: true,
			})),
			questions.map(() => false),
		);
	};

	const toggleCollapsed = () =>
	{
		const root = cardRootRef.current;
		const active = document.activeElement;
		const focusInside = root !== null && active !== root && root.contains(active);
		// Upstream refocuses the root on a collapse with focus inside, or on an expand from the toggle.
		const refocus = collapsed ? active === toggleRef.current : focusInside;
		setCollapsed(!collapsed);
		if (refocus)
			root?.focus(
				{
					preventScroll: true,
				},
			);
	};

	const onRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) =>
	{
		if (
			event.key === " " &&
			event.target === event.currentTarget &&
			!(event.altKey || event.ctrlKey || event.metaKey)
		)
			event.preventDefault();
		roveAnswers(event);
	};

	const rawQuestion = stripMemoryTags(question.question);
	const otherFill = rowFill(draft.otherChosen, multi && highlighted === -1);

	return (
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- upstream's group root: arrows rove its answers and clicks stop short of the transcript
		<div
			ref={cardRootRef}
			role="group"
			tabIndex={-1}
			aria-labelledby={titleId}
			data-approval-card-root=""
			data-focus-region="question"
			{...(collapsed
				?
					{
						"data-collapsed": "",
					}
				: {})}
			{...(skipEnter
				?
					{
						"data-skip-approval-enter": "",
					}
				: {})}
			onClick={(event) =>
			{
				event.stopPropagation();
			}}
			onKeyDown={collapsed ? undefined : onRootKeyDown}
			className={`epitaxy-approval-card @container relative isolate flex max-h-[60vh] flex-col gap-[12px] rounded-card p-3 text-body text-primary origin-top outline-none${
				skipEnter ? "" : " animate-approval-inline-enter motion-reduce:animate-none"
			}`}
		>
			<ApprovalStackGhosts queueDepth={queueDepth} />
			<ApprovalDockBackdrop />
			<div
				ref={bodyRef}
				className="epitaxy-approval-body -mx-3 flex min-h-0 flex-col gap-[12px] overflow-y-auto overscroll-contain px-3"
			>
				<div className="text-primary min-h-[24px] shrink-0 flex items-center gap-1">
					<span className="flex flex-1 min-w-0 flex-col gap-[2px]">
						<span className="flex items-start gap-xs min-w-0">
							{collapsed && questions.length > 1 && (
								<span
									className="grid shrink-0 place-items-center rounded-full bg-[var(--upstream-bg-warning)] px-sm text-caption tabular-nums text-warning"
									style={
									{
										height: "var(--text-body--line-height)",
									}}
								>
									{`${index + 1}/${questions.length}`}
								</span>
							)}
							<span data-question-stop-name="" className="text-body-medium min-w-0 break-words">
								<span
									id={titleId}
									className="block select-text whitespace-pre-wrap [unicode-bidi:plaintext]"
								>
									<UserInlineText text={rawQuestion} codeLook="chip" revealCloaks />
								</span>
							</span>
						</span>
					</span>
					<span className="shrink-0 self-center">
						<span className="flex items-center gap-0.5">
							<button
								ref={toggleRef}
								type="button"
								aria-expanded={!collapsed}
								aria-label="View question options"
								onMouseDown={keepFocus}
								onClick={toggleCollapsed}
								className={ICON_BUTTON_CLASS}
							>
								<Icon
									name="CaretRight"
									rotate={collapsed ? 0 : 90}
									className="transition-transform duration-fast motion-reduce:transition-none"
								/>
							</button>
							{editable && (
								<button
									type="button"
									aria-label="Dismiss question"
									onMouseDown={keepFocus}
									onClick={dismiss}
									className={ICON_BUTTON_CLASS}
								>
									<Icon name="X" />
								</button>
							)}
						</span>
					</span>
				</div>
				<Collapsible.Root open={!collapsed}>
					<Collapsible.Panel>
						<div ref={listRef} className="flex flex-col gap-0.75">
							{question.options.map((option, optionIndex) => (
								<DockedOption
									key={`${optionIndex}-${option.label}`}
									label={maskSecrets(option.label)}
									description={maskSecrets(option.description ?? "")}
									multi={multi}
									selected={draft.selected.includes(optionIndex)}
									highlighted={highlighted === optionIndex}
									disabled={!editable}
									onPick={(event) =>
									{
										pick(optionIndex, event);
									}}
								/>
							))}
							<div className={`flex flex-col gap-[12px] rounded-r4 px-md py-md ${otherFill}`}>
								<button
									type="button"
									{...
									{
										[ANSWER_ATTR]: "",
									}}
									{...(multi
										?
											{
												"aria-pressed": draft.otherChosen,
											}
										: {})}
									disabled={!editable}
									onClick={(event) =>
									{
										if (selectionInside(event)) return;
										pick(-1, event);
									}}
									className={`flex items-center gap-sm text-body text-primary text-start ${OPTION_FOCUS}`}
								>
									<span className="flex-1 select-text">Other</span>
									{multi && <RowCheckbox checked={draft.otherChosen} />}
								</button>
								<textarea
									ref={otherRef}
									aria-label="Other option"
									dir="auto"
									placeholder="Type your own answer here"
									rows={1}
									tabIndex={draft.otherChosen ? 0 : -1}
									value={editable ? draft.other : maskSecrets(draft.other)}
									disabled={!editable}
									style={
									{
										maxHeight: "calc(4lh + 2 * var(--cds-pad-sm))",
									}}
									onChange={(event) =>
									{
										const next = typeOther(question, draft, event.target.value);
										setDrafts((current) =>
											current.map((entry, at) => (at === index ? next : entry)),
										);
										setSkipped((current) =>
											current.map((entry, at) => (at === index ? false : entry)),
										);
									}}
									onClick={(event) =>
									{
										event.stopPropagation();
									}}
									onKeyDown={(event) =>
									{
										if (event.key === "ArrowUp" || event.key === "ArrowDown")
										{
											event.stopPropagation();
											return;
										}
										// Upstream's `pt`: Escape hands focus back to the card, keeping the text.
										if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
										event.preventDefault();
										cardRootRef.current?.focus(
											{
												preventScroll: true,
											},
										);
									}}
									className="min-h-[calc(1lh+2*var(--cds-pad-sm))] w-full resize-none rounded-[var(--upstream-radius)] bg-fill-field px-md py-sm font-sans text-body text-primary outline-none [field-sizing:content] placeholder:text-ink-muted shadow-field-ring transition duration-150 hover:shadow-field-hover focus-visible:shadow-focus disabled:opacity-50"
								/>
							</div>
						</div>
					</Collapsible.Panel>
				</Collapsible.Root>
			</div>
			{multi && (
				<span role="status" data-find-omitted="" className="sr-only select-none">
					{draft.selected.length + (draft.otherChosen ? 1 : 0)} selected
				</span>
			)}
			{error !== null && <p className="text-footnote text-danger-ink">{error}</p>}
			{onSubmit === undefined && <ReadOnlyAnswerHint className="text-footnote text-secondary" />}
			<Collapsible.Root open={!collapsed}>
				<Collapsible.Panel>
					<div
						className={`flex items-center justify-end gap-[8px] @container ${questions.length > 1 ? "epitaxy-question-paged" : "epitaxy-question-solo"}`}
					>
						{questions.length > 1 && (
							<DockedPager
								position={index + 1}
								count={questions.length}
								previous={
								{
									label: "Show previous question",
									endLabel: "No previous question",
									inert: index === 0,
									onPress: (event) =>
									{
										goTo(index - 1, event.detail === 0);
									},
								}}
								next={
								{
									label: "Show next question",
									endLabel: isLast ? "No next question" : "Choose an option or skip this question",
									inert: isLast || !picked,
									onPress: advance,
								}}
							/>
						)}
						<ApprovalActionButton
							variant="secondary"
							disabled={!editable}
							onMouseDown={keepFocus}
							onClick={skip}
						>
							Skip
						</ApprovalActionButton>
						<ApprovalActionButton
							variant="primary"
							disabled={!editable || !picked}
							onMouseDown={keepFocus}
							onClick={advance}
						>
							{isLast ? submitLabel : "Next"}
						</ApprovalActionButton>
					</div>
				</Collapsible.Panel>
			</Collapsible.Root>
		</div>
	);
}
