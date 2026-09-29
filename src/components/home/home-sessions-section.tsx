import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { useViewportRowLimit } from "../../hooks/use-viewport-row-limit";
import { approvalsQueryOptions } from "../../lib/api/approvals";
import {
  homeDismissalsQueryOptions,
  postHomeDismissal,
  type HomeDismissals,
} from "../../lib/api/home-dismissals";
import { recentSessionsInfiniteQueryOptions, type SessionListItem } from "../../lib/api/sessions";
import { selectHomeAttention, type HomeAttentionRow } from "../../lib/home-attention";
import { usePins } from "../../lib/pin-store";
import { toGroupRow } from "../sidebar/session-group-section";
import { AttentionSection } from "./attention-section";

function toAttentionRow(
  session: SessionListItem,
  approvalTools: ReadonlyMap<string, string>,
): HomeAttentionRow {
  const toolName = approvalTools.get(session.id);
  return {
    ...toGroupRow(session),
    pendingApproval: toolName === undefined ? null : { toolName },
    summary: session.summary ?? null,
    statusDetail: null,
    lastAssistantText: null,
  };
}

/** The home "Sessions" section fed by the sidebar's recent sessions, pins and dismissals. */
export function HomeSessionsSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rowLimit = useViewportRowLimit();
  const { pinnedIds } = usePins();
  const { data: recent } = useInfiniteQuery(recentSessionsInfiniteQueryOptions());
  const { data: approvals } = useQuery(approvalsQueryOptions());
  const { data: dismissals } = useQuery(homeDismissalsQueryOptions);

  const dismiss = useMutation({
    mutationFn: postHomeDismissal,
    onMutate: (sessionId) => {
      queryClient.setQueryData<HomeDismissals>(homeDismissalsQueryOptions.queryKey, (previous) => ({
        dismissals: { ...previous?.dismissals, [sessionId]: Date.now() },
      }));
    },
    onSuccess: (data) => queryClient.setQueryData(homeDismissalsQueryOptions.queryKey, data),
  });

  if (recent === undefined || dismissals === undefined) return null;

  const now = Date.now();
  const approvalTools = new Map(
    (approvals?.approvals ?? []).map((approval) => [approval.sessionId, approval.toolName]),
  );
  const items = selectHomeAttention({
    rows: recent.pages.flatMap((page) =>
      page.sessions.map((session) => toAttentionRow(session, approvalTools)),
    ),
    pinnedIds: new Set(pinnedIds),
    dismissed: dismissals.dismissals,
    now,
  });

  return (
    <AttentionSection
      items={items}
      rowLimit={rowLimit}
      now={now}
      onOpen={(id) => void navigate({ to: "/session/$id", params: { id } })}
      onDismiss={(item) => dismiss.mutate(item.session.sessionId)}
    />
  );
}
