import {useState, type ReactNode} from 'react';
import {Loader2} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {useAskUserQuestionContext} from '../ask-user-question-context';
import {
	answerForQuestion,
	makeInitialDraft,
	normalizeQuestions,
	parseAnswerResult,
	type ParsedAnswer,
	type QuestionDraft,
	type QuestionLike,
} from '../../lib/ask-user-question';

function IndexBadge({children, focused}: {children: ReactNode; focused?: boolean}) {
	return (
		<span
			className={`relative flex size-[30px] shrink-0 items-center justify-center rounded-[10px] overflow-hidden text-sm ${
				focused ? 'bg-bg-400 text-text-100' : 'bg-bg-300 text-text-500'
			}`}
		>
			{children}
		</span>
	);
}

function OptionDivider({hidden}: {hidden?: boolean}) {
	return (
		<div
			aria-hidden="true"
			className={`h-[0.5px] bg-border-300 mx-3 transition-opacity duration-150 ${hidden ? 'opacity-0' : ''}`}
		/>
	);
}

function ReadOnlyAnswer({label, description, index}: {label: string; description?: string | undefined; index: number}) {
	return (
		<div className="group/row flex w-full items-center gap-3 h-[3.5rem] px-3 text-left bg-bg-200 rounded-2xl">
			<IndexBadge focused>{index}</IndexBadge>
			<div className="flex flex-col flex-1 min-w-0">
				<span className="text-sm text-text-000 truncate">{label}</span>
				{description && <span className="text-xs text-text-500 truncate">{description}</span>}
			</div>
		</div>
	);
}

function ReadOnlyOption({label, description, index}: {label: string; description?: string | undefined; index: number}) {
	return (
		<div className="group/row flex w-full items-center gap-3 h-[3.5rem] px-3 text-left rounded-2xl opacity-50">
			<IndexBadge>{index}</IndexBadge>
			<div className="flex flex-col flex-1 min-w-0">
				<span className="text-sm text-text-300 truncate">{label}</span>
				{description && <span className="text-xs text-text-500 truncate">{description}</span>}
			</div>
		</div>
	);
}

function NotesLine({notes}: {notes: string}) {
	return (
		<p className="text-text-500 mt-1 ml-3 italic whitespace-pre-wrap text-xs">
			<span className="text-text-300">Notes: </span>
			{notes}
		</p>
	);
}

/**
 * True when the user's note adds information beyond the answer value itself.
 * When the user picks 'Other' and types a custom answer, Claude Code echoes
 * the same string in both fields; suppress that redundant duplicate.
 */
function notesAddInformation(notes: string | null | undefined, answerValue: string): boolean {
	if (notes === null || notes === undefined) return false;
	const trimmed = notes.trim();
	return trimmed !== '' && trimmed !== answerValue.trim();
}

function ReadOnlyOtherAnswer({value, notes}: {value: string; notes?: string | null}) {
	return (
		<div className="group/row flex w-full items-center gap-3 h-[3.5rem] px-3 text-left bg-bg-200 rounded-2xl">
			<IndexBadge focused>
				<PencilIcon />
			</IndexBadge>
			<div className="flex flex-col flex-1 min-w-0">
				<span className="text-sm text-text-000 truncate">{value}</span>
			</div>
			{notesAddInformation(notes, value) && <NotesLine notes={notes!} />}
		</div>
	);
}

function PencilIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 256 256"
			fill="currentColor"
		>
			<path d="M227.31,73.37,182.63,28.69a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.69,147.31,64l24-24L216,84.69Z" />
		</svg>
	);
}

/**
 * Render a question after it has been answered (or when no submission UI is
 * active). Uses the parsed answer (when available) to figure out which option
 * was chosen and whether to surface supplementary user notes.
 */
function AnsweredQuestion({question, header, options, parsed}: QuestionLike & {parsed?: ParsedAnswer | undefined}) {
	const answerValue = parsed?.answer.trim() ?? '';
	const matchesAny = options.some((opt) => opt.label === answerValue);
	const isOther = answerValue.length > 0 && !matchesAny;
	const notes = parsed?.notes;

	return (
		<div>
			{header && <p className="text-xs text-text-500 mb-1 pl-3">{header}</p>}
			<p className="text-sm text-text-100 mb-2 pl-3">{question}</p>
			<div className="flex flex-col">
				{options.map((opt, optionIndex) => {
					const isLast = optionIndex === options.length - 1 && !isOther;
					if (opt.label === answerValue) {
						return (
							<div key={opt.label}>
								<ReadOnlyAnswer
									label={opt.label}
									description={opt.description}
									index={optionIndex + 1}
								/>
								{notes !== null && notes !== undefined && notes.trim() !== '' && (
									<NotesLine notes={notes} />
								)}
								{!isLast && <OptionDivider hidden />}
							</div>
						);
					}
					return (
						<div key={opt.label}>
							<ReadOnlyOption
								label={opt.label}
								description={opt.description}
								index={optionIndex + 1}
							/>
							{!isLast && <OptionDivider />}
						</div>
					);
				})}
				{isOther && (
					<>
						<OptionDivider hidden />
						<ReadOnlyOtherAnswer
							value={answerValue}
							notes={notes ?? null}
						/>
					</>
				)}
			</div>
		</div>
	);
}

/**
 * Interactive answer form rendered when the session is active and the question
 * is still pending. Renders the same options as the read-only view but lets
 * the user pick one (or many, if multiSelect) plus a free-text 'Other' field.
 */
function AnswerForm({
	questions,
	onSubmit,
}: {
	questions: QuestionLike[];
	onSubmit: (answers: Array<{question: string; answer: string}>) => Promise<void>;
}) {
	const [drafts, setDrafts] = useState<QuestionDraft[]>(() => questions.map(() => makeInitialDraft()));
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const completed = questions.every((q, i) => answerForQuestion(q, drafts[i]!) !== null);

	function updateDraft(index: number, mutator: (draft: QuestionDraft) => QuestionDraft) {
		setDrafts((prev) => prev.map((d, i) => (i === index ? mutator(d) : d)));
	}

	function toggleOption(index: number, label: string) {
		const question = questions[index]!;
		updateDraft(index, (draft) => {
			const next: QuestionDraft = {
				selected: new Set(draft.selected),
				otherText: draft.otherText,
				useOther: false,
			};
			if (question.multiSelect) {
				if (next.selected.has(label)) {
					next.selected.delete(label);
				} else {
					next.selected.add(label);
				}
			} else {
				next.selected = new Set([label]);
			}
			return next;
		});
	}

	function selectOther(index: number) {
		updateDraft(index, (draft) => ({
			selected: new Set(),
			otherText: draft.otherText,
			useOther: true,
		}));
	}

	function setOtherText(index: number, value: string) {
		updateDraft(index, (draft) => ({
			selected: draft.selected,
			otherText: value,
			useOther: true,
		}));
	}

	async function handleSubmit() {
		if (!completed || submitting) return;
		setError(null);
		setSubmitting(true);
		try {
			const answers = questions.map((q, i) => ({
				question: q.question,
				answer: answerForQuestion(q, drafts[i]!) ?? '',
			}));
			await onSubmit(answers);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to submit answer');
			setSubmitting(false);
		}
	}

	async function handleSkip() {
		if (submitting) return;
		setError(null);
		setSubmitting(true);
		try {
			const answers = questions.map((q) => ({
				question: q.question,
				answer: '',
			}));
			await onSubmit(answers);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to skip');
			setSubmitting(false);
		}
	}

	return (
		<div className="flex flex-col gap-4 rounded-[20px] bg-bg-000/90 backdrop-blur-md pt-4 shadow-[0_0.25rem_1.25rem_rgba(0,0,0,0.075),0_0_0_0.5px_hsla(var(--border-200)/0.3)] overflow-hidden">
			{questions.map((q, index) => {
				const draft = drafts[index]!;
				const isMulti = q.multiSelect ?? false;
				return (
					<div key={index}>
						<div className="flex items-center gap-2 pl-5 pb-2 pr-3">
							<span className="flex-1 text-text-100 text-sm">{q.question}</span>
							{q.header && <span className="text-xs text-text-500 shrink-0">{q.header}</span>}
						</div>
						<div className="flex-1 p-1.5">
							<div className="flex flex-col">
								{q.options.map((opt, optionIndex) => {
									const selected = draft.selected.has(opt.label) && !draft.useOther;
									const isLast = optionIndex === q.options.length - 1;
									return (
										<div key={opt.label}>
											<button
												type="button"
												onClick={() => toggleOption(index, opt.label)}
												disabled={submitting}
												className={`group/row flex w-full items-center gap-3 h-[3.5rem] px-3 text-left cursor-pointer transition-colors rounded-2xl ${
													selected ? 'bg-bg-200' : 'hover:bg-bg-100'
												} disabled:cursor-not-allowed disabled:opacity-50`}
											>
												{isMulti ? (
													<div className="flex size-[30px] shrink-0 items-center justify-center">
														<input
															type="checkbox"
															checked={selected}
															readOnly
															className="w-5 h-5 pointer-events-none"
														/>
													</div>
												) : (
													<IndexBadge focused={selected}>{optionIndex + 1}</IndexBadge>
												)}
												<div className="flex flex-col flex-1 min-w-0">
													<span
														className={`text-sm truncate ${selected ? 'text-text-000' : 'text-text-300'}`}
													>
														{opt.label}
													</span>
													{opt.description && (
														<span className="text-xs text-text-500 truncate">
															{opt.description}
														</span>
													)}
												</div>
												{selected && !isMulti && (
													<span
														className="text-text-100/50 text-sm shrink-0 mr-2"
														aria-hidden="true"
													>
														⏎
													</span>
												)}
											</button>
											{!isLast && <OptionDivider hidden={selected} />}
										</div>
									);
								})}
								<OptionDivider hidden={draft.useOther} />
								<div
									className={`group/row flex w-full items-center gap-3 h-[3.5rem] px-3 text-left cursor-text rounded-2xl ${
										draft.useOther ? 'bg-bg-200' : 'hover:bg-bg-100'
									}`}
									onClick={() => selectOther(index)}
								>
									{isMulti ? (
										<div className="flex size-[30px] shrink-0 items-center justify-center">
											<input
												type="checkbox"
												checked={draft.useOther && draft.otherText.trim().length > 0}
												readOnly
												className="w-5 h-5 pointer-events-none"
											/>
										</div>
									) : (
										<IndexBadge focused={draft.useOther}>
											<PencilIcon />
										</IndexBadge>
									)}
									<input
										type="text"
										value={draft.otherText}
										onChange={(e) => setOtherText(index, e.target.value)}
										onFocus={() => selectOther(index)}
										disabled={submitting}
										placeholder="Type your answer"
										className="flex-1 min-w-0 w-full bg-transparent text-sm text-text-100 placeholder:text-text-500 placeholder:opacity-60 outline-none ring-0 border-0 shadow-none focus:ring-0 focus:!outline-none focus:border-0 focus:shadow-none"
									/>
								</div>
							</div>
						</div>
						{isMulti && (
							<p className="mt-1 text-[10px] text-text-500 italic pl-5">Select one or more options.</p>
						)}
					</div>
				);
			})}
			{error && (
				<div className="rounded border border-danger-000/30 bg-danger-000/10 px-2.5 py-1.5 text-xs text-danger-000 mx-3">
					{error}
				</div>
			)}
			<div className="h-[0.5px] bg-border-300 mx-0" />
			<div className="flex items-center justify-end gap-2 px-4 pb-3">
				<button
					type="button"
					onClick={handleSkip}
					disabled={submitting}
					className="inline-flex items-center gap-1.5 rounded-md border border-border-300/15 px-3 py-1.5 text-xs font-medium text-text-300 hover:bg-bg-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
				>
					Skip
				</button>
				<button
					type="button"
					onClick={handleSubmit}
					disabled={!completed || submitting}
					className="inline-flex items-center gap-1.5 rounded-md bg-accent-100 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-100/80 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
				>
					{submitting ? (
						<Loader2
							size={12}
							className="animate-spin"
						/>
					) : null}
					{submitting ? 'Submitting...' : 'Submit'}
				</button>
			</div>
		</div>
	);
}

export function AskUserQuestionRenderer({toolCall}: ToolRendererProps) {
	const ctx = useAskUserQuestionContext();
	const questions = normalizeQuestions(toolCall.input);
	const {result} = toolCall;
	const isPending = result === undefined;
	const canAnswer = ctx?.isSessionActive === true && isPending && questions !== null;

	if (canAnswer) {
		return (
			<AnswerForm
				questions={questions}
				onSubmit={(answers) => ctx.submitAnswer({toolUseId: toolCall.id, answers})}
			/>
		);
	}

	if (!questions) {
		const singleQuestion = (toolCall.input['question'] as string) ?? '';
		return (
			<div>
				<p className="text-sm text-text-100">{singleQuestion}</p>
				{result && <p className="text-sm text-text-500 mt-1 whitespace-pre-wrap">{result}</p>}
			</div>
		);
	}

	const parsed = result !== undefined ? parseAnswerResult(result, questions) : null;
	const parsedByQuestion = new Map<string, ParsedAnswer>();
	if (parsed) {
		for (const entry of parsed) {
			parsedByQuestion.set(entry.question, entry);
		}
	}

	// Parsing can fail when the result text predates the canonical envelope
	// or has an unexpected shape. Fall back to displaying the raw text so we
	// don't silently lose information.
	const showRawFallback = result !== undefined && parsed === null;

	const questionElements = questions.map((q, i) => (
		<AnsweredQuestion
			key={i}
			question={q.question}
			{...(q.header ? {header: q.header} : {})}
			options={q.options}
			parsed={parsedByQuestion.get(q.question)}
		/>
	));

	return (
		<div className="flex flex-col gap-4 rounded-[20px] bg-bg-000/90 backdrop-blur-md pt-4 pb-4 shadow-[0_0.25rem_1.25rem_rgba(0,0,0,0.075),0_0_0_0.5px_hsla(var(--border-200)/0.3)] overflow-hidden">
			{questionElements}
			{showRawFallback && <p className="text-sm text-text-500 mt-1 whitespace-pre-wrap px-5">{result}</p>}
		</div>
	);
}
