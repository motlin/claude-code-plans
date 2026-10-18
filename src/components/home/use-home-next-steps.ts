import {useInfiniteQuery, useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";

import {approvalsQueryOptions} from "../../lib/api/approvals";
import {homeDismissalsQueryOptions, postHomeDismissal, type HomeDismissals} from "../../lib/api/home-dismissals";
import {recentSessionsInfiniteQueryOptions, type SessionListItem} from "../../lib/api/sessions";
import {nextStepKey, prNextStepCandidates, selectNextSteps, type NextStepCandidate} from "../../lib/home-next-steps";
import {selectHomePrs} from "../../lib/home-prs";
import {toGroupRow} from "../sidebar/sidebar-session-row";
import type {NextStepsListProps} from "./start-card";

/**
 * Upstream's waiting-session candidates: every titled, unarchived session awaiting input, asking a
 * question unless a non-AskUserQuestion permission prompt is pending.
 */
function waitingSessionCandidates(
	sessions: readonly SessionListItem[],
	approvalTools: ReadonlyMap<string, string>,
): NextStepCandidate[] {
	return sessions
		.map((session) => ({row: toGroupRow(session), toolName: approvalTools.get(session.id)}))
		.filter(({row}) => row.bucket === "blocked" && !row.archived && row.title.trim() !== "")
		.map(({row, toolName}) => ({
			id: "waiting-session",
			subject: row.sessionId,
			stamp: row.lastActivityAt,
			title: row.title.trim(),
			detail: toolName !== undefined && toolName !== "AskUserQuestion" ? "Needs permission" : "Asked a question",
		}));
}

/**
 * The start card's Next steps list, fed by the sidebar's recent sessions, their PRs and the home
 * dismissals; undefined until those have loaded.
 */
export function useHomeNextSteps(): NextStepsListProps | undefined {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const {data: recent} = useInfiniteQuery(recentSessionsInfiniteQueryOptions());
	const {data: approvals} = useQuery(approvalsQueryOptions());
	const {data: dismissals} = useQuery(homeDismissalsQueryOptions);

	const dismiss = useMutation({
		mutationFn: postHomeDismissal,
		onMutate: (key) => {
			queryClient.setQueryData<HomeDismissals>(homeDismissalsQueryOptions.queryKey, (previous) => ({
				dismissals: {...previous?.dismissals, [key]: Date.now()},
			}));
		},
		onSuccess: (data) => queryClient.setQueryData(homeDismissalsQueryOptions.queryKey, data),
	});

	if (recent === undefined || dismissals === undefined) return undefined;

	const sessions = recent.pages.flatMap((page) => page.sessions);
	const approvalTools = new Map(
		(approvals?.approvals ?? []).map((approval) => [approval.sessionId, approval.toolName]),
	);
	const prs = selectHomePrs(
		sessions
			.filter((session) => !session.archived)
			.map((session) => ({
				sessionId: session.id,
				sessionTitle: session.title,
				lastActivityAt: Date.parse(session.mtime),
				pr: session.prStatus,
			})),
	);

	return {
		rows: selectNextSteps({
			candidates: [...waitingSessionCandidates(sessions, approvalTools), ...prNextStepCandidates(prs)],
			dismissed: dismissals.dismissals,
		}),
		onOpen: (id) => void navigate({to: "/session/$id", params: {id}}),
		onDismiss: (candidates) => {
			for (const candidate of candidates) dismiss.mutate(nextStepKey(candidate));
		},
	};
}
