import {useState} from 'react';
import {Check, Circle, Loader2, MessageCircleQuestion, Send} from 'lucide-react';
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

function ReadOnlyAnswer({label, description}: {label: string; description?: string | undefined}) {
	return (
		<div className="rounded border bg-accent-900 border-accent-100/30 border-l-2 border-l-accent-100 px-2.5 py-1.5 text-xs">
			<div className="flex items-center gap-1.5">
				<Check
					size={14}
					className="text-accent-100 shrink-0"
				/>
				<span className="font-medium">{label}</span>
			</div>
			{description && <p className="text-text-500 mt-0.5 ml-5">{description}</p>}
		</div>
	);
}

function ReadOnlyOption({label, description}: {label: string; description?: string | undefined}) {
	return (
		<div className="rounded border border-border-300/15 opacity-60 px-2.5 py-1.5 text-xs">
			<div className="flex items-center gap-1.5">
				<Circle
					size={14}
					className="text-text-500 shrink-0"
				/>
				<span className="font-medium">{label}</span>
			</div>
			{description && <p className="text-text-500 mt-0.5 ml-5">{description}</p>}
		</div>
	);
}

function NotesLine({notes}: {notes: string}) {
	return (
		<p className="text-text-500 mt-1 ml-5 italic whitespace-pre-wrap text-xs">
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
		<div className="rounded border border-warning-000/30 bg-warning-100/10 border-l-2 border-l-warning-000 px-2.5 py-1.5 text-xs">
			<div className="flex items-center gap-1.5">
				<Check
					size={14}
					className="text-warning-000 shrink-0"
				/>
				<span className="font-medium">Other</span>
			</div>
			<p className="text-text-500 mt-0.5 ml-5 whitespace-pre-wrap">{value}</p>
			{notesAddInformation(notes, value) && <NotesLine notes={notes!} />}
		</div>
	);
}

/**
 * Render a question after it has been answered (or when no submission UI is
 * active). Uses the parsed answer (when available) to figure out which option
 * was chosen and whether to surface supplementary user notes.
 */
function AnsweredQuestion({question, options, parsed}: QuestionLike & {parsed?: ParsedAnswer | undefined}) {
	const answerValue = parsed?.answer.trim() ?? '';
	const matchesAny = options.some((opt) => opt.label === answerValue);
	const isOther = answerValue.length > 0 && !matchesAny;
	const notes = parsed?.notes;

	return (
		<div>
			<div className="flex items-start gap-1.5 mb-2">
				<MessageCircleQuestion
					size={14}
					className="text-text-500 shrink-0 mt-0.5"
				/>
				<p className="text-sm font-medium whitespace-pre-wrap">{question}</p>
			</div>
			<div className="flex flex-col gap-1.5 ml-5">
				{options.map((opt) => {
					if (opt.label === answerValue) {
						return (
							<div key={opt.label}>
								<ReadOnlyAnswer
									label={opt.label}
									description={opt.description}
								/>
								{notes !== null && notes !== undefined && notes.trim() !== '' && (
									<NotesLine notes={notes} />
								)}
							</div>
						);
					}
					return (
						<ReadOnlyOption
							key={opt.label}
							label={opt.label}
							description={opt.description}
						/>
					);
				})}
				{isOther && (
					<ReadOnlyOtherAnswer
						value={answerValue}
						notes={notes ?? null}
					/>
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

	return (
		<div className="flex flex-col gap-4">
			{questions.map((q, index) => {
				const draft = drafts[index]!;
				const isMulti = q.multiSelect ?? false;
				return (
					<div key={index}>
						<div className="flex items-start gap-1.5 mb-2">
							<MessageCircleQuestion
								size={14}
								className="text-text-500 shrink-0 mt-0.5"
							/>
							<p className="text-sm font-medium">{q.question}</p>
						</div>
						<div className="flex flex-col gap-1.5 ml-5">
							{q.options.map((opt) => {
								const selected = draft.selected.has(opt.label) && !draft.useOther;
								return (
									<button
										key={opt.label}
										type="button"
										onClick={() => toggleOption(index, opt.label)}
										disabled={submitting}
										className={`text-left rounded border px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${
											selected
												? 'bg-accent-900 border-accent-100/30 border-l-2 border-l-accent-100'
												: 'border-border-300/15 hover:bg-bg-200/50'
										} disabled:cursor-not-allowed disabled:opacity-50`}
									>
										<div className="flex items-center gap-1.5">
											{selected ? (
												<Check
													size={14}
													className="text-accent-100 shrink-0"
												/>
											) : (
												<Circle
													size={14}
													className="text-text-500 shrink-0"
												/>
											)}
											<span className="font-medium">{opt.label}</span>
										</div>
										{opt.description && (
											<p className="text-text-500 mt-0.5 ml-5">{opt.description}</p>
										)}
									</button>
								);
							})}
							<div
								className={`rounded border px-2.5 py-1.5 text-xs ${
									draft.useOther
										? 'bg-warning-100/10 border-warning-000/30 border-l-2 border-l-warning-000'
										: 'border-border-300/15'
								}`}
							>
								<div className="flex items-center gap-1.5">
									<button
										type="button"
										onClick={() => selectOther(index)}
										disabled={submitting}
										className="cursor-pointer disabled:cursor-not-allowed"
									>
										{draft.useOther ? (
											<Check
												size={14}
												className="text-warning-000 shrink-0"
											/>
										) : (
											<Circle
												size={14}
												className="text-text-500 shrink-0"
											/>
										)}
									</button>
									<span className="font-medium">Other</span>
								</div>
								<input
									type="text"
									value={draft.otherText}
									onChange={(e) => setOtherText(index, e.target.value)}
									onFocus={() => selectOther(index)}
									disabled={submitting}
									placeholder="Type a custom answer..."
									className="mt-1 ml-5 w-[calc(100%-1.25rem)] rounded border border-border-300/15 bg-bg-000 px-2 py-1 text-xs text-text-100 outline-none focus:border-accent-100/40 disabled:opacity-50"
								/>
							</div>
						</div>
						{isMulti && (
							<p className="ml-5 mt-1 text-[10px] text-text-500 italic">Select one or more options.</p>
						)}
					</div>
				);
			})}
			{error && (
				<div className="rounded border border-danger-000/30 bg-danger-000/10 px-2.5 py-1.5 text-xs text-danger-000">
					{error}
				</div>
			)}
			<div className="flex items-center gap-2">
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
					) : (
						<Send size={12} />
					)}
					{submitting ? 'Sending...' : 'Send answer'}
				</button>
				<span className="text-[10px] text-text-500 italic">
					Forks the session so the running CLI keeps working uninterrupted.
				</span>
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
				<div className="flex items-start gap-1.5">
					<MessageCircleQuestion
						size={14}
						className="text-text-500 shrink-0 mt-0.5"
					/>
					<p className="text-sm font-medium">{singleQuestion}</p>
				</div>
				{result && <p className="text-sm text-text-500 mt-1 ml-5">{result}</p>}
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

	if (questions.length > 1) {
		return (
			<div className="flex flex-col gap-3">
				{questions.map((q, i) => (
					<AnsweredQuestion
						key={i}
						question={q.question}
						options={q.options}
						parsed={parsedByQuestion.get(q.question)}
					/>
				))}
				{showRawFallback && <p className="text-sm text-text-500 mt-1 whitespace-pre-wrap">{result}</p>}
			</div>
		);
	}

	const only = questions[0]!;
	return (
		<>
			<AnsweredQuestion
				question={only.question}
				options={only.options}
				parsed={parsedByQuestion.get(only.question)}
			/>
			{showRawFallback && <p className="text-sm text-text-500 mt-1 ml-5 whitespace-pre-wrap">{result}</p>}
		</>
	);
}
