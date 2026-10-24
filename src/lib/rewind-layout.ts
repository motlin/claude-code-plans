/**
 * Where the transcript draws each served rewind cut (transcript-chain.ts) and
 * which abandoned rows it still draws. Normal views never receive the hidden
 * rows, so only the markers land, each just before its replacement prompt.
 * Verbose keeps the raw rows: a cut's abandoned rows (the hidden rows since the
 * previous replacement, in file order) sit behind its marker, which then moves
 * up to open them.
 */

import type {TranscriptCut} from "./api/sessions";
import type {SessionLine} from "./sessions";

export interface RewindMarkerPlacement {
	cut: TranscriptCut;
	/** Upstream `l_`: the cut's time is shown only when two or more cuts share a parent. */
	label: string;
	/** The on-chain prompt the cut opens onto, which also keys its disclosure. */
	replacementUuid: string;
	/** The cut has abandoned rows in this window to disclose. */
	hasRows: boolean;
}

export interface RewindLayout {
	lines: SessionLine[];
	/**
	 * Markers keyed by the lineIndex of the row they are drawn just before: the
	 * first abandoned row in Verbose (drawn or held back), else the replacement.
	 */
	markersBefore: ReadonlyMap<number, readonly RewindMarkerPlacement[]>;
	/** lineIndex of every abandoned row drawn, greyed. */
	greyed: ReadonlySet<number>;
}

const NO_MARKERS: ReadonlyMap<number, readonly RewindMarkerPlacement[]> = new Map();
const NO_GREYED: ReadonlySet<number> = new Set();

/** Upstream's middot-and-time suffix after the label, with every space in the time made non-breaking. */
function rewindMarkerLabel(cut: TranscriptCut, sharesParent: boolean): string {
	if (!sharesParent) return "Rewound here";
	const time = new Date(cut.at).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
	return `Rewound here \u00B7\u00A0${time.replace(/\s/g, "\u00A0")}`;
}

export function rewindLayout(
	lines: SessionLine[],
	cutsByReplacement: ReadonlyMap<string, readonly TranscriptCut[]>,
	rewound: ReadonlySet<string>,
	verbose: boolean,
	openCuts: ReadonlySet<string>,
): RewindLayout {
	if (cutsByReplacement.size === 0) return {lines, markersBefore: NO_MARKERS, greyed: NO_GREYED};
	const parentCounts = new Map<string, number>();
	for (const cuts of cutsByReplacement.values()) {
		for (const cut of cuts) parentCounts.set(cut.parentUuid, (parentCounts.get(cut.parentUuid) ?? 0) + 1);
	}
	const markersBefore = new Map<number, RewindMarkerPlacement[]>();
	const closed = new Set<number>();
	const greyed = new Set<number>();
	let pending: SessionLine[] = [];
	for (const line of lines) {
		const uuid = "uuid" in line ? line.uuid : undefined;
		if (uuid === undefined) continue;
		if (rewound.has(uuid)) {
			pending.push(line);
			continue;
		}
		const cuts = cutsByReplacement.get(uuid);
		if (cuts === undefined) continue;
		const replacementUuid = uuid;
		const rows = verbose ? pending : [];
		const open = openCuts.has(replacementUuid);
		for (const row of rows) (open ? greyed : closed).add(row.lineIndex);
		// Anchored at the first held-back row whether open or not, so toggling keeps the marker's row.
		const anchor = rows[0] ?? line;
		markersBefore.set(
			anchor.lineIndex,
			cuts.map((cut) => ({
				cut,
				label: rewindMarkerLabel(cut, (parentCounts.get(cut.parentUuid) ?? 0) > 1),
				replacementUuid,
				hasRows: rows.length > 0,
			})),
		);
		pending = [];
	}
	// Abandoned rows whose replacement is outside this window stay in the raw view, greyed.
	for (const row of pending) greyed.add(row.lineIndex);
	return {
		lines: closed.size === 0 ? lines : lines.filter((line) => !closed.has(line.lineIndex)),
		markersBefore,
		greyed,
	};
}
