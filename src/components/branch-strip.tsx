import {
	FolderGit2,
	GitBranch,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
	X,
} from "lucide-react";
import {useCallback, useEffect, useRef, useState} from "react";

import type {SessionDetailData} from "../lib/api/sessions";
import {requestChangesScope} from "../lib/changes-scope-request";
import {pluralize} from "../lib/pluralize";
import {prGlyph} from "../lib/pr-status";
import {useOptionalPaneHost} from "./panes/tile-host";
import {ProjectMenuItems} from "./session-titlebar";
import {Menu, MenuContent, MenuTrigger} from "./ui/menu";

/** Upstream hides the strip in a tile this narrow or narrower. */
const HIDDEN_AT_OR_BELOW_PX = 320;

/** Longest branch label before the middle is elided; the full name stays in the tooltip. */
const BRANCH_MAX_CHARS = 32;

const DISMISS_KEY_PREFIX = "branch-strip-dismissed:";

const GHOST_BUTTON =
	"inline-flex h-6 min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-r5 px-1.5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 data-[popup-open]:bg-fill-ghost-hover";

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

function numberAt(data: Record<string, unknown> | null, group: string, key: string) {
	const value = data?.[group];
	if (value === null || typeof value !== "object") return undefined;
	const leaf = (value as Record<string, unknown>)[key];
	return typeof leaf === "number" ? leaf : undefined;
}

interface LineCounts {
	additions: number;
	deletions: number;
}

/** `+N −M` from the statusline's `cost.total_lines_added/removed`, or null when nothing changed. */
function lineCounts(statusline: Record<string, unknown> | null): LineCounts | null {
	const additions = numberAt(statusline, "cost", "total_lines_added") ?? 0;
	const deletions = numberAt(statusline, "cost", "total_lines_removed") ?? 0;
	return additions > 0 || deletions > 0 ? {additions, deletions} : null;
}

function readDismissed(sessionId: string): boolean {
	try {
		return sessionStorage.getItem(DISMISS_KEY_PREFIX + sessionId) === "1";
	} catch {
		return false;
	}
}

function writeDismissed(sessionId: string): void {
	try {
		sessionStorage.setItem(DISMISS_KEY_PREFIX + sessionId, "1");
	} catch {
		// Storage is unavailable; the dismissal lasts until the page reloads.
	}
}

/** Dismissal is per session and per tab, like upstream. */
function useDismissed(sessionId: string): [boolean, () => void] {
	const [dismissed, setDismissed] = useState(false);
	useEffect(() => setDismissed(readDismissed(sessionId)), [sessionId]);
	const dismiss = useCallback(() => {
		writeDismissed(sessionId);
		setDismissed(true);
	}, [sessionId]);
	return [dismissed, dismiss];
}

function useContainerWidth() {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState<number | null>(null);
	useEffect(() => {
		const element = ref.current;
		if (element === null || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((entries) => {
			const measured = entries[0]?.contentRect.width;
			if (measured !== undefined) setWidth(measured);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return {ref, width};
}

function DiffStatButton({sessionId, additions, deletions}: {sessionId: string; additions: number; deletions: number}) {
	const host = useOptionalPaneHost();
	const added = additions.toLocaleString("en-US");
	const removed = deletions.toLocaleString("en-US");
	return (
		<button
			type="button"
			title="Show changes"
			className={`${GHOST_BUTTON} tabular-nums`}
			onClick={() => {
				requestChangesScope(sessionId, "branch");
				host?.openPane("changes");
			}}
		>
			<span aria-hidden="true">
				<span className="text-diff-added">+{added}</span> <span className="text-diff-removed">−{removed}</span>
			</span>
			<span className="sr-only">
				{`${added} ${pluralize(additions, "addition")}, ${removed} ${pluralize(deletions, "deletion")}`}
			</span>
		</button>
	);
}

/** Show known PR metadata, or the existing session branch and line-count strip before a PR. */
export function branchStripVisible(session: BranchStripSession, counts: LineCounts | null): boolean {
	if (session.pr !== undefined || session.prStatus !== undefined) return true;
	return session.gitBranch !== null || counts !== null;
}

/** A linked PR owns its identity; only status with the same number and URL may decorate it. */
function pullRequestSummary(session: BranchStripSession) {
	if (session.pr !== undefined) {
		const status = session.prStatus;
		return {
			number: session.pr.number,
			url: session.pr.url,
			repository: session.pr.repository,
			status: status?.number === session.pr.number && status.url === session.pr.url ? status : undefined,
		};
	}
	if (session.prStatus === undefined) return null;
	return {
		number: session.prStatus.number,
		url: session.prStatus.url,
		repository: undefined,
		status: session.prStatus,
	};
}

const PR_REPOSITORY_BUTTON =
	"inline-flex h-6 min-w-0 max-w-[160px] shrink cursor-pointer items-center rounded-r5 px-[5px] text-[13px] leading-[19px] opacity-60 transition-colors hover:bg-fill-ghost-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 data-[popup-open]:bg-fill-ghost-hover";

const PR_STATE_ICONS = {
	open: GitPullRequest,
	draft: GitPullRequestDraft,
	merged: GitMerge,
	closed: GitPullRequestClosed,
};

const PR_STATE_LABELS = {open: "Open", draft: "Draft", merged: "Merged", closed: "Closed"} as const;

function PullRequestStripContent({
	sessionId,
	session,
	pr,
}: {
	sessionId: string;
	session: BranchStripSession;
	pr: NonNullable<ReturnType<typeof pullRequestSummary>>;
}) {
	const color = pr.status === undefined ? undefined : `var(--color-git-${prGlyph(pr.status).state})`;
	const Icon = pr.status === undefined ? GitPullRequest : PR_STATE_ICONS[pr.status.state];
	const label = `#${pr.number}`;
	const repositoryName = pr.repository?.slice(pr.repository.lastIndexOf("/") + 1).trim();
	return (
		<>
			<div className="flex min-w-0 flex-1 items-center gap-0">
				<Icon aria-hidden className="size-4 shrink-0" style={{color}} />
				{pr.url === undefined ? (
					<span className="shrink-0 px-[5px] tabular-nums" style={{color}}>
						{label}
					</span>
				) : (
					<a
						href={pr.url}
						target="_blank"
						rel="noopener noreferrer"
						className="shrink-0 rounded-r5 px-[5px] tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
						style={{color}}
					>
						{label}
					</a>
				)}
				{pr.repository !== undefined && repositoryName && (
					<>
						<span aria-hidden className="w-3 min-w-0 shrink" />
						<Menu>
							<MenuTrigger
								aria-label={`Repository ${pr.repository}`}
								title={pr.repository}
								className={PR_REPOSITORY_BUTTON}
								style={{color}}
							>
								<span className="truncate">{repositoryName}</span>
							</MenuTrigger>
							<MenuContent>
								<ProjectMenuItems sessionId={sessionId} session={session} />
							</MenuContent>
						</Menu>
					</>
				)}
			</div>
			<span className="shrink-0 whitespace-nowrap" style={{color}}>
				{pr.status === undefined ? "Status unknown" : PR_STATE_LABELS[pr.status.state]}
			</span>
		</>
	);
}

/**
 * Known PR metadata, or the session branch and cumulative edit counts before a PR.
 * PR head branches and PR diff counts remain absent until the data contract provides them.
 */
export function BranchStrip({
	sessionId,
	session,
	statusline,
}: {
	sessionId: string;
	session: BranchStripSession;
	statusline: Record<string, unknown> | null;
}) {
	const [dismissed, dismiss] = useDismissed(sessionId);
	const {ref, width} = useContainerWidth();
	const counts = lineCounts(statusline);
	const branch = session.gitBranch;
	const pr = pullRequestSummary(session);
	const prColor = pr?.status === undefined ? undefined : `var(--color-git-${prGlyph(pr.status).state})`;

	if (dismissed || !branchStripVisible(session, counts)) return null;
	const narrow = width !== null && width <= HIDDEN_AT_OR_BELOW_PX;
	const path = session.projectPath ?? session.cwd;

	return (
		<div ref={ref}>
			{!narrow && (
				<div
					data-branch-strip=""
					data-pull-request-strip={pr === null ? undefined : ""}
					className={
						pr === null
							? "mb-2 flex min-h-10 min-w-0 items-center gap-1 rounded-r7 bg-alpha-1 p-2 text-[13px]"
							: "flex min-h-10 min-w-0 items-center gap-[5px] rounded-r7 bg-alpha-1 p-2 text-[13px] leading-[19px] text-secondary"
					}
					style={
						prColor === undefined
							? undefined
							: {backgroundColor: `color-mix(in srgb, ${prColor} 20%, transparent)`}
					}
				>
					{pr === null ? (
						<>
							<Menu>
								<MenuTrigger title={path ?? session.projectName} className={GHOST_BUTTON}>
									<FolderGit2 aria-hidden className="size-3.5 shrink-0" />
									<span className="truncate">{session.projectName}</span>
								</MenuTrigger>
								<MenuContent>
									<ProjectMenuItems sessionId={sessionId} session={session} />
								</MenuContent>
							</Menu>
							{branch !== null && (
								<span
									data-branch-name=""
									title={branch}
									className="inline-flex min-w-0 items-center gap-1 px-1.5 font-mono text-secondary"
								>
									<GitBranch aria-hidden className="size-3.5 shrink-0" />
									<span className="truncate">{middleTruncate(branch, BRANCH_MAX_CHARS)}</span>
								</span>
							)}
							{counts !== null && <DiffStatButton sessionId={sessionId} {...counts} />}
						</>
					) : (
						<PullRequestStripContent sessionId={sessionId} session={session} pr={pr} />
					)}
					<button
						type="button"
						aria-label="Dismiss"
						title="Dismiss"
						className={
							pr === null
								? `${GHOST_BUTTON} ml-auto`
								: "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 p-0 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
						}
						onClick={dismiss}
					>
						<X aria-hidden className="size-3.5" />
					</button>
				</div>
			)}
		</div>
	);
}
