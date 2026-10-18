import {useInfiniteQuery, useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";

import {useViewportRowLimit} from "../../hooks/use-viewport-row-limit";
import {approvalsQueryOptions} from "../../lib/api/approvals";
import {homeDismissalsQueryOptions, postHomeDismissal, type HomeDismissals} from "../../lib/api/home-dismissals";
import {recentSessionsInfiniteQueryOptions, type SessionListItem} from "../../lib/api/sessions";
import {selectHomeAttention, type HomeAttentionItem, type HomeAttentionRow} from "../../lib/home-attention";
import {nextStepKey, prNextStepCandidates, selectNextSteps, type NextStepCandidate} from "../../lib/home-next-steps";
import {selectHomePrs, type HomePrRow} from "../../lib/home-prs";
import {usePins} from "../../lib/pin-store";
import {toGroupRow} from "../sidebar/sidebar-session-row";
import type {NextStepsListProps} from "./start-card";

function toAttentionRow(session: SessionListItem, approvalTools: ReadonlyMap<string, string>): HomeAttentionRow {
	const toolName = approvalTools.get(session.id);
	return {
		...toGroupRow(session),
		pendingApproval: toolName === undefined ? null : {toolName},
		summary: session.summary ?? null,
		statusDetail: null,
		lastAssistantText: null,
	};
}

/**
 * Upstream's waiting-session candidates: every titled, unarchived session awaiting input, asking a
 * question unless a non-AskUserQuestion permission prompt is pending.
 */
function waitingSessionCandidates(rows: readonly HomeAttentionRow[]): NextStepCandidate[] {
	return rows
		.filter((row) => row.bucket === "blocked" && !row.archived && row.title.trim() !== "")
		.map((row) => ({
			id: "waiting-session",
			subject: row.sessionId,
			stamp: row.lastActivityAt,
			title: row.title.trim(),
			detail:
				row.pendingApproval !== null && row.pendingApproval.toolName !== "AskUserQuestion"
					? "Needs permission"
					: "Asked a question",
		}));
}

export interface HomeAttention {
	items: HomeAttentionItem<HomeAttentionRow>[];
	/** Active PRs from the same sessions, for the Pull requests section. */
	prs: HomePrRow[];
	/** The start card's Next steps list. */
	nextSteps: NextStepsListProps;
	rowLimit: number;
	now: number;
	onOpen: (sessionId: string) => void;
	onDismiss: (item: HomeAttentionItem<HomeAttentionRow>) => void;
}

/**
 * The home action center's Sessions and Pull requests rows, fed by the sidebar's recent sessions, pins and
 * dismissals; undefined until those have loaded.
 */
export function useHomeAttention(): HomeAttention | undefined {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const rowLimit = useViewportRowLimit();
	const {pinnedIds} = usePins();
	const {data: recent} = useInfiniteQuery(recentSessionsInfiniteQueryOptions());
	const {data: approvals} = useQuery(approvalsQueryOptions());
	const {data: dismissals} = useQuery(homeDismissalsQueryOptions);

	const dismiss = useMutation({
		mutationFn: postHomeDismissal,
		onMutate: (sessionId) => {
			queryClient.setQueryData<HomeDismissals>(homeDismissalsQueryOptions.queryKey, (previous) => ({
				dismissals: {...previous?.dismissals, [sessionId]: Date.now()},
			}));
		},
		onSuccess: (data) => queryClient.setQueryData(homeDismissalsQueryOptions.queryKey, data),
	});

	if (recent === undefined || dismissals === undefined) return undefined;

	const now = Date.now();
	const sessions = recent.pages.flatMap((page) => page.sessions);
	const approvalTools = new Map(
		(approvals?.approvals ?? []).map((approval) => [approval.sessionId, approval.toolName]),
	);
	const rows = sessions.map((session) => toAttentionRow(session, approvalTools));
	const items = selectHomeAttention({
		rows,
		pinnedIds: new Set(pinnedIds),
		dismissed: dismissals.dismissals,
		now,
	});

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

	const onOpen = (id: string) => void navigate({to: "/session/$id", params: {id}});

	return {
		items,
		prs,
		nextSteps: {
			rows: selectNextSteps({
				candidates: [...waitingSessionCandidates(rows), ...prNextStepCandidates(prs)],
				dismissed: dismissals.dismissals,
			}),
			onOpen,
			onDismiss: (candidates) => {
				for (const candidate of candidates) dismiss.mutate(nextStepKey(candidate));
			},
		},
		rowLimit,
		now,
		onOpen,
		onDismiss: (item) => {
			dismiss.mutate(item.session.sessionId);
		},
	};
}
