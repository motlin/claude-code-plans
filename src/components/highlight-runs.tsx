import type {TextMatch} from "../lib/search-text";

interface Run {
	text: string;
	highlighted: boolean;
}

function toRuns(text: string, matches: readonly TextMatch[]): Run[] {
	const merged: TextMatch[] = [];
	for (const match of [...matches].sort((a, b) => a.start - b.start)) {
		const start = Math.max(0, match.start);
		const end = Math.min(text.length, match.end);
		if (end <= start) continue;
		const last = merged.at(-1);
		if (last !== undefined && start <= last.end) last.end = Math.max(last.end, end);
		else merged.push({start, end});
	}
	const runs: Run[] = [];
	let cursor = 0;
	for (const {start, end} of merged) {
		if (start > cursor) runs.push({text: text.slice(cursor, start), highlighted: false});
		runs.push({text: text.slice(start, end), highlighted: true});
		cursor = end;
	}
	if (cursor < text.length) runs.push({text: text.slice(cursor), highlighted: false});
	return runs;
}

/** Renders search-match offsets as upstream's semibold primary runs. */
export function HighlightRuns({text, matches}: {text: string; matches: readonly TextMatch[]}) {
	return (
		<>
			{toRuns(text, matches).map((run, i) =>
				run.highlighted ? (
					<span key={i} className="font-semibold text-primary">
						{run.text}
					</span>
				) : (
					<span key={i}>{run.text}</span>
				),
			)}
		</>
	);
}
