import type {SessionDetailData} from "../lib/api/sessions";

/** The session fields the strip reads. */
export type BranchStripSession = Pick<
	SessionDetailData,
	"projectName" | "projectPath" | "cwd" | "gitBranch" | "pr" | "prStatus"
>;

/** `feature/abc…xyz`: keeps the start and end of a name longer than `max` characters. */
export function middleTruncate(text: string, max: number): string {
	if (text.length <= max) return text;
	const kept = max - 1;
	const head = Math.ceil(kept / 2);
	const tail = kept - head;
	return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

export interface LineCounts {
	additions: number;
	deletions: number;
}

/** Show known PR metadata, or the existing session branch and line-count strip before a PR. */
export function branchStripVisible(session: BranchStripSession, counts: LineCounts | null): boolean {
	if (session.pr !== undefined || session.prStatus !== undefined) return true;
	return session.gitBranch !== null || counts !== null;
}
