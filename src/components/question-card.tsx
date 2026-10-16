import {Check, ChevronLeft, ChevronRight} from "lucide-react";
import {useState, type KeyboardEvent} from "react";

import type {QuestionAnswer} from "../lib/hook-events";
import type {QuestionLike} from "../lib/ask-user-question";
import {READ_ONLY_ANSWER_HINT} from "../lib/question-answer-route";
import {chooseOther, pickOption, type QuestionCardDraft, typeOther} from "../lib/question-card-draft";
import {ApprovalActionButton} from "./approval-card";
import {Shortcut} from "./ui/shortcut";

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

/**
 * Upstream's pending AskUserQuestion card, drawn inline at most 480px wide: the
 * question in a grey header with an "N of M" pager, radio (or checkbox) rows of
 * label and description split by hairlines, an Other row that reveals its text
 * box once chosen, and Skip beside Next / Submit (⌘⏎). With `onSubmit` it
 * answers one answer per question, null for a skipped one; without it every
 * control is disabled.
 */
export function QuestionCard({
	questions,
	onSubmit,
	submitLabel = "Submit",
}: {
	questions: readonly QuestionLike[];
	onSubmit?: ((answers: Array<QuestionAnswer | null>) => Promise<void>) | undefined;
	/** The last page's primary label: "Submit", or the fork route's explicit one. */
	submitLabel?: string;
}) {
	const [page, setPage] = useState(0);
	const [drafts, setDrafts] = useState<QuestionCardDraft[]>(() => questions.map(initialDraft));
	const [skipped, setSkipped] = useState<boolean[]>(() => questions.map(() => false));
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const index = Math.min(page, questions.length - 1);
	const question = questions[index];
	const draft = drafts[index];
	if (question === undefined || draft === undefined) return null;
	const editable = onSubmit !== undefined && !sending;
	const multi = question.multiSelect === true;
	const isLast = index === questions.length - 1;
	const settled = (at: number) => skipped[at] === true || isAnswered(drafts[at] ?? initialDraft(question));
	const unanswered = questions.findIndex((_, at) => !settled(at));
	const canAdvance = isLast ? unanswered === -1 : isAnswered(draft);

	const update = (next: QuestionCardDraft) => {
		setDrafts((current) => current.map((entry, at) => (at === index ? next : entry)));
		setSkipped((current) => current.map((entry, at) => (at === index ? false : entry)));
	};

	const submit = async (finalDrafts: QuestionCardDraft[], finalSkipped: boolean[]) => {
		if (onSubmit === undefined) return;
		setError(null);
		setSending(true);
		try {
			await onSubmit(finalDrafts.map((entry, at) => (finalSkipped[at] === true ? null : answerOf(entry))));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to send the answer");
			setSending(false);
		}
	};

	const advance = () => {
		if (!editable || !canAdvance) return;
		if (isLast) void submit(drafts, skipped);
		else setPage(index + 1);
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
		if (remaining === -1) void submit(nextDrafts, nextSkipped);
		else setPage(remaining);
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			advance();
		}
	};

	return (
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- ⌘⏎ from any control in the card advances it, as upstream's panel shortcut
		<div
			role="group"
			aria-label={question.question}
			data-approval-card-root=""
			data-approval-presentation="card"
			onKeyDown={onKeyDown}
			className="card-ring @container relative isolate flex max-w-[480px] flex-col overflow-clip rounded-r7 outline-none"
		>
			<div className="flex items-center gap-3 bg-alpha-1 px-3 py-2">
				<div className="min-w-0 flex-1 text-body text-primary select-text break-words [unicode-bidi:plaintext]">
					{question.question}
				</div>
				{questions.length > 1 && (
					<span className="-my-1.5 -me-1 flex shrink-0 items-center gap-1.5 text-caption text-ink-muted">
						<button
							type="button"
							aria-label="Show previous question"
							disabled={index === 0 || sending}
							onMouseDown={(event) => {
								event.preventDefault();
							}}
							onClick={() => {
								setPage(index - 1);
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
								setPage(index + 1);
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
							onClick={() => {
								if (window.getSelection()?.isCollapsed === false) return;
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
						onClick={() => {
							update(chooseOther(question, draft));
						}}
						className="absolute inset-0 cursor-pointer outline-none hide-focus-ring focus-visible:ring-focus disabled:cursor-default"
					/>
					<span aria-hidden="true" className="contents">
						<Mark checked={draft.otherChosen} multi={multi} />
						<span className="text-body text-primary">Other</span>
					</span>
					{draft.otherChosen && (
						<textarea
							aria-label="Other option"
							placeholder="Type your own answer here"
							rows={1}
							value={draft.other}
							disabled={!editable}
							onChange={(event) => {
								update(typeOther(question, draft, event.target.value));
							}}
							className="relative z-[1] col-start-2 row-start-2 max-h-[calc(4lh+0.5rem)] w-full resize-none rounded-r5 bg-transparent px-1 py-1 text-body text-primary outline-none [field-sizing:content] placeholder:text-ink-muted shadow-[inset_0_0_0_1px_var(--card-outline)]"
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
				className={`epitaxy-approval-actions flex items-center justify-end gap-1 px-3 pt-2 pb-3 ${STACK_ACTIONS}`}
			>
				<ApprovalActionButton variant="secondary" disabled={!editable} onClick={skip}>
					Skip
				</ApprovalActionButton>
				<ApprovalActionButton variant="primary" disabled={!editable || !canAdvance} onClick={advance}>
					{isLast ? submitLabel : "Next"}
					<Shortcut keys="cmd+enter" className="pointer-coarse:hidden" />
				</ApprovalActionButton>
			</div>
		</div>
	);
}
