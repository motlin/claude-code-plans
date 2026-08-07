import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { approvalsQueryOptions } from "../lib/api/approvals";
import { sessionTitlesQueryOptions } from "../lib/api/sessions";
import { toMdSlug } from "../lib/md-slug";
import { formatRelativeTimeFromIso } from "../lib/relative-time";
import { pillStyles } from "../components/detail-top-bar";
import { ListPageHeader } from "../components/list-page-header";

export const Route = createFileRoute("/approvals")({
  component: ApprovalsPage,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(approvalsQueryOptions()),
  head: () => ({
    meta: [{ title: "Approvals" }],
  }),
});

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function ApprovalsPage() {
  const { data } = useSuspenseQuery(approvalsQueryOptions());
  const approvals = data.approvals;

  const sessionIds = useMemo(() => approvals.map((a) => a.sessionId), [approvals]);
  const { data: titlesData } = useQuery(sessionTitlesQueryOptions(sessionIds));
  const titles = titlesData?.titles ?? {};

  return (
    <div>
      <ListPageHeader title="Approvals" count={approvals.length} itemLabel="approval" />

      {approvals.length === 0 ? (
        <p className="mt-8 text-center text-text-500">Nothing waiting on you right now.</p>
      ) : (
        <ul className="mt-4 space-y-1">
          {approvals.map((approval) => {
            const sessionTitle = titles[approval.sessionId] ?? approval.sessionId;
            const linkProps = approval.planFilename
              ? ({
                  to: "/plan/$filename",
                  params: { filename: toMdSlug(approval.planFilename) },
                } as const)
              : ({
                  to: "/session/$id",
                  params: { id: approval.sessionId },
                } as const);

            return (
              <li key={`${approval.sessionId}:${approval.toolUseId}`}>
                <Link
                  {...linkProps}
                  className="block rounded-md border border-border-300/15 p-3 no-underline transition-colors hover:bg-bg-200/50"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-text-000">
                      {approval.projectName}
                    </span>
                    <span className={pillStyles.outline}>{approval.toolName}</span>
                    <span className="ml-auto text-xs text-text-500">
                      {formatRelativeTimeFromIso(approval.blockedSince)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-text-500">{sessionTitle}</div>
                  {approval.questionPreview && approval.toolName === "AskUserQuestion" && (
                    <div className="mt-1 truncate text-xs text-text-400 italic">
                      {truncate(approval.questionPreview, 120)}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
