/** One answered question of a receipt: the question, the answer line, and the user's notes when they add something. */
export interface QuestionReceiptRow {
	question: string;
	answer: string;
	notes: string | null;
}

/**
 * True when the user's note adds information beyond the answer value itself.
 * When the user picks 'Other' and types a custom answer, Claude Code echoes
 * the same string in both fields; suppress that redundant duplicate.
 */
function notesAddInformation(notes: string | null, answerValue: string): notes is string {
	if (notes === null) return false;
	const trimmed = notes.trim();
	return trimmed !== "" && trimmed !== answerValue.trim();
}

/**
 * One row of upstream's question receipt: the question in primary w500 over the
 * chosen answer (or the Other text, or the unanswered outcome's word) in secondary.
 * Unchosen options are omitted.
 */
function AnsweredQuestion({question, answer, notes}: QuestionReceiptRow) {
	const trimmed = answer.trim();
	return (
		<div data-answered-question className="flex flex-col gap-0.5 px-3 py-2">
			<p className="text-body font-medium text-primary break-words [unicode-bidi:plaintext]">{question}</p>
			{trimmed !== "" && (
				<p className="text-body text-secondary [overflow-wrap:anywhere] [unicode-bidi:plaintext]">{trimmed}</p>
			)}
			{notesAddInformation(notes, trimmed) && (
				<p className="text-footnote text-secondary italic whitespace-pre-wrap">
					<span className="text-primary">Notes: </span>
					{notes}
				</p>
			)}
		</div>
	);
}

/**
 * Upstream's `epitaxy-question-receipt`: every answered pair of one call in a
 * 480px card, divided by its ring's hairline, 3px nearer the row above and 7px
 * further from the next. With `enters` it fades in, as when it replaces a live card.
 */
export function QuestionReceipt({rows, enters}: {rows: readonly QuestionReceiptRow[]; enters: boolean}) {
	return (
		<div
			data-question-receipt=""
			className={`card-ring -mt-[3px] mb-[7px] flex w-full max-w-[480px] flex-col divide-y divide-[var(--card-outline)] overflow-clip rounded-r6 select-text${
				enters ? " animate-question-receipt-enter motion-reduce:animate-none" : ""
			}`}
		>
			{rows.map((row, i) => (
				<AnsweredQuestion key={i} question={row.question} answer={row.answer} notes={row.notes} />
			))}
		</div>
	);
}
