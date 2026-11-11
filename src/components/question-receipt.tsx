import {useState} from "react";
import {maskSecrets} from "../lib/secret-mask";
import {stripMemoryTags} from "../lib/task-checklist";
import {revealSpoofing} from "../lib/visible-text";

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
 * Upstream's `Hc` (cb6930dae): memory tags dropped, secrets masked, the lines trimmed with blank ones
 * dropped and joined by `separator`, then spoofing characters revealed (`u9(ME(Ee(text)))`).
 */
function receiptText(text: string, separator: string): string {
	return revealSpoofing(
		maskSecrets(stripMemoryTags(text))
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.join(separator),
	);
}

/**
 * One row of upstream's question receipt: the question in primary at the control weight (435 under fizzy type) over the
 * chosen answer (or the Other text, or the unanswered outcome's word) in secondary,
 * its newlines kept and capped at 250px with its own scroll. Unchosen options are omitted.
 */
function AnsweredQuestion({question, answer, notes}: QuestionReceiptRow) {
	const shown = receiptText(answer, "\n");
	return (
		<div data-answered-question className="flex flex-col gap-0.5 px-lg py-md">
			<div className="text-body font-control text-primary break-words [unicode-bidi:plaintext]">
				{receiptText(question, " ")}
			</div>
			{shown !== "" && (
				<div className="max-h-[250px] overflow-y-auto whitespace-pre-wrap text-body text-secondary [overflow-wrap:anywhere] [unicode-bidi:plaintext]">
					{shown}
				</div>
			)}
			{notesAddInformation(notes, answer) && (
				<div className="text-footnote text-secondary italic whitespace-pre-wrap">
					<span className="text-primary">Notes: </span>
					{notes}
				</div>
			)}
		</div>
	);
}

/**
 * Upstream's `epitaxy-question-receipt`: every answered pair of one call in a
 * 480px card, divided by its ring's hairline, with the transcript item gap below it. With `enters` it fades in, as when it replaces a live card.
 * Like upstream's `wd` it reads `enters` once, so a later `true` never restarts the
 * fade; a later `false` drops the class, which ends it without replaying.
 */
export function QuestionReceipt({rows, enters}: {rows: readonly QuestionReceiptRow[]; enters: boolean}) {
	const [entersAtMount] = useState(enters);
	const fades = entersAtMount && enters;
	return (
		<div
			data-question-receipt=""
			className={`card-ring mb-[var(--chat-item-gap)] flex w-full max-w-[480px] flex-col divide-y divide-[var(--card-outline)] overflow-clip rounded-r6 select-text${
				fades ? " animate-question-receipt-enter motion-reduce:animate-none" : ""
			}`}
		>
			{rows.map((row, i) => (
				<AnsweredQuestion key={i} question={row.question} answer={row.answer} notes={row.notes} />
			))}
		</div>
	);
}
