import type {GitPrState} from "./pr-status";
import type {SessionBucket} from "./session-state";

/** The second line of a "described" sidebar row (Show ▸ Metadata), upstream's `L2` model. */
export type SessionMetaLine =
	| {kind: "blocked"; word: boolean; reason?: string}
	| {kind: "place"; pr?: GitPrState; branch?: string; folder?: string};

export interface SessionMetaLineInput {
	bucket: SessionBucket;
	/** The row sits under the Needs input group, which already says "blocked". */
	underNeedsInput: boolean;
	reason?: string | undefined;
	/** The PR glyph state, which leads the line in place of the branch glyph. */
	pr?: GitPrState | undefined;
	branch?: string | undefined;
	folder?: string | undefined;
	heading?: string | undefined;
}

/** Upstream `ep`: the group heading already names the folder, so the line needn't repeat it. */
function headingNamesFolder(heading: string | undefined, folder: string): boolean {
	return heading === folder || (heading?.startsWith(`${folder} · `) ?? false);
}

export function sessionMetaLine({
	bucket,
	underNeedsInput,
	reason,
	pr,
	branch,
	folder,
	heading,
}: SessionMetaLineInput): SessionMetaLine | undefined {
	if (bucket === "blocked") {
		const word = !underNeedsInput;
		if (!word && reason === undefined) return undefined;
		return reason === undefined ? {kind: "blocked", word} : {kind: "blocked", word, reason};
	}
	const showFolder =
		folder !== undefined && (!headingNamesFolder(heading, folder) || (branch === undefined && pr !== undefined));
	if (branch === undefined && !showFolder) return undefined;
	return {
		kind: "place",
		...(pr === undefined ? {} : {pr}),
		...(branch === undefined ? {} : {branch}),
		...(showFolder ? {folder} : {}),
	};
}
