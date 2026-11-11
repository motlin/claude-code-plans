import type {DiffFileMark} from "../../lib/diff-file-marks";

export type {DiffFileMark};

/** Upstream `Iu` (was `Rs`): the "… N more" and index-flag rows of huge or flagged diffs, which get no More button. */
export function isSyntheticDiffRow(path: string): boolean {
	return path.startsWith("… ") || path.includes(" hidden from Git by index flags (");
}

/**
 * Upstream's `show` for the header's "…" button: a viewed mark exists, or the whole-file toggle is offered (its
 * loader exists and the view-wide expandUnchanged is off) on a real file.
 */
export function diffFileMenuButtonShown({
	path,
	mark,
	wholeFileOffered,
}: {
	path: string;
	mark: DiffFileMark | undefined;
	wholeFileOffered: boolean;
}): boolean {
	return mark !== undefined || (wholeFileOffered && !isSyntheticDiffRow(path));
}
