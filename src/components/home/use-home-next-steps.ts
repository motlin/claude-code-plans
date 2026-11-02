import {useInfiniteQuery, useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {useRef} from "react";

import {approvalsQueryOptions} from "../../lib/api/approvals";
import {blockedDetail} from "../../lib/blocked-detail";
import {homeDismissalsQueryOptions, postHomeDismissal, type HomeDismissals} from "../../lib/api/home-dismissals";
import {homeFolderPrQueryOptions} from "../../lib/api/home-folder-pr";
import {homeFolderStatusQueryOptions} from "../../lib/api/home-folder-status";
import {recentSessionsInfiniteQueryOptions, type SessionListItem} from "../../lib/api/sessions";
import {withAwaitingAck} from "../../lib/awaiting-ack-overlay";
import {ackedAt, useAwaitingAckVersion} from "../../lib/awaiting-ack-store";
import {useLiveApprovalIds} from "../../lib/live-approval-sessions";
import
{
	folderNextStepCandidates,
	folderPrBranch,
	folderPrNextStepCandidates,
	nextStepKey,
	selectNextSteps,
	sessionRunningIn,
	type NextStepCandidate,
} from "../../lib/home-next-steps";
import {useAnsweredSessionIds, withAnsweredHolds} from "../../lib/answered-sessions";
import {toGroupRow} from "../sidebar/sidebar-session-row";
import {useHomeDraftUsed, useHomeLaunchFolder, useHomeWorktree} from "./launch-folder";
import type {NextStepsListProps} from "./start-card";

/**
 * Upstream's waiting-session candidates: every titled, unarchived session awaiting input, asking a
 * question unless a non-AskUserQuestion permission prompt is pending. A session blocked on its unseen
 * error is the folder's resume-session row instead.
 */
function waitingSessionCandidates(
	sessions: readonly SessionListItem[],
	approvalTools: ReadonlyMap<string, string>,
): NextStepCandidate[]
{
	return sessions
		.filter((session) => session.unseenError !== true)
		.map((session) => (
		{
			row: toGroupRow(session),
			toolName: approvalTools.get(session.id),
		}))
		.filter(({row}) => row.bucket === "blocked" && !row.archived && row.title.trim() !== "")
		.map(({row, toolName}) => (
		{
			id: "waiting-session",
			subject: row.sessionId,
			stamp: row.lastActivityAt,
			title: row.title.trim(),
			detail: blockedDetail(toolName),
		}));
}

/**
 * Upstream's failed session for the launch folder: the newest unarchived session in exactly that project
 * that is blocked on an error nobody has seen since (the server's `erroredAt` carries all of its gates).
 */
function newestFailedSession(
	sessions: readonly SessionListItem[],
	projectId: string | undefined,
):
{
	sessionId: string;
	title: string;
	failedAt: number;
} | null
{
	let failed:
	{
		sessionId: string;
		title: string;
		failedAt: number;
	} | null = null;
	for (const session of sessions)
	{
		if (session.project !== projectId || session.archived || session.erroredAt === undefined) continue;
		// Upstream's folder scan (`gge`) skips a failed session whose trimmed title is blank.
		const title = session.title.trim();
		if (title === "") continue;
		const failedAt = Date.parse(session.erroredAt);
		if (failed === null || failedAt > failed.failedAt)
		{
			failed =
			{
				sessionId: session.id,
				title,
				failedAt,
			};
		}
	}
	return failed;
}

/**
 * The start card's Next steps list, fed by the sidebar's recent sessions, the pending approvals, the
 * launch folder and its branch's PR (read under `HomeLaunchFolderProvider`) and the home dismissals. Like
 * upstream, it is undefined until every source has settled (so a permission prompt never first renders
 * as "Asked a question"), then latched: a later reset or refetch that drops a source's data keeps the
 * last list instead of unmounting it.
 */
export function useHomeNextSteps(): NextStepsListProps | undefined
{
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const {data: recent} = useInfiniteQuery(recentSessionsInfiniteQueryOptions());
	const {data: approvals, isFetched: approvalsFetched} = useQuery(approvalsQueryOptions());
	const {data: dismissals} = useQuery(homeDismissalsQueryOptions);
	const {selected, launching} = useHomeLaunchFolder();
	const folder = selected?.projectPath;
	const {data: git} = useQuery(homeFolderStatusQueryOptions(folder));
	const worktree = useHomeWorktree(git?.isGitRepo);
	// Upstream's `yce` runs only for a git folder on a non-default branch with Worktree off.
	const {data: folderPr} = useQuery(homeFolderPrQueryOptions(folder, folderPrBranch(git, worktree.enabled)));
	const {used} = useHomeDraftUsed();
	const latched = useRef<NextStepsListProps | undefined>(undefined);
	const answeredIds = useAnsweredSessionIds();
	// Re-render when this browser marks a session completed; the overlay reads the store.
	useAwaitingAckVersion();
	const liveApprovalIds = useLiveApprovalIds();

	const dismiss = useMutation(
		{
			mutationFn: postHomeDismissal,
			onMutate: (key) =>
			{
				queryClient.setQueryData<HomeDismissals>(homeDismissalsQueryOptions.queryKey, (previous) => (
				{
					dismissals:
					{
						...previous?.dismissals,
						[key]: Date.now(),
					},
				}));
			},
			onSuccess: (data) => queryClient.setQueryData(homeDismissalsQueryOptions.queryKey, data),
		},
	);

	if (recent === undefined || dismissals === undefined || !approvalsFetched) return latched.current;

	// A session marked completed is idle and one this tab just answered is working again, as the sidebar draws them.
	const sessions = withAnsweredHolds(
		recent.pages
			.flatMap((page) => page.sessions)
			.map((session) => withAwaitingAck(session, ackedAt(session.id), liveApprovalIds.has(session.id))),
		answeredIds,
	);
	const approvalTools = new Map(
		(approvals?.approvals ?? []).map((approval) => [approval.sessionId, approval.toolName]),
	);
	const folderCandidates = folderNextStepCandidates(
		{
			folder,
			git,
			runningHere: sessionRunningIn(sessions, selected?.id),
			worktreeOn: worktree.enabled,
			worktreeTaken: folder !== undefined && worktree.isTaken(folder),
			used,
			failed: newestFailedSession(sessions, selected?.id),
			launching,
		},
	);

	latched.current =
	{
		rows: selectNextSteps(
			{
				candidates: [
					...waitingSessionCandidates(sessions, approvalTools),
					...folderCandidates,
					...folderPrNextStepCandidates(
						{
							git,
							pr: folderPr,
							worktreeOn: worktree.enabled,
							used,
							launching,
						},
					),
				],
				dismissed: dismissals.dismissals,
			},
		),
		onOpen: (id) =>
			void navigate(
				{
					to: "/session/$id",
					params:
					{
						id,
					},
				},
			),
		onDismiss: (candidates) =>
		{
			for (const candidate of candidates) dismiss.mutate(nextStepKey(candidate));
		},
	};
	return latched.current;
}
