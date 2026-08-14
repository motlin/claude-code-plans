import { createFileRoute, useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { SessionPage } from "../components/session-page";
import { herdrPanesQueryOptions } from "../lib/api/herdr";
import {
  sessionDetailQueryOptions,
  sessionSubagentsQueryOptions,
  transcriptQueryOptions,
} from "../lib/api/sessions";

export const Route = createFileRoute("/session/$id")({
  component: SessionRouteComponent,
  // Warm the caches without awaiting them. With `ssr: false` nothing paints
  // until every matched loader resolves, and a long session's transcript runs
  // to megabytes of JSONL, so awaiting here means a blank white page. The
  // component renders the shell plus a skeleton instead. Reading the detail
  // cache is synchronous, so a warm visit still titles the tab immediately.
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.prefetchQuery(sessionDetailQueryOptions(params.id));
    void queryClient.prefetchQuery(transcriptQueryOptions(params.id));
    void queryClient.prefetchQuery(sessionSubagentsQueryOptions(params.id));
    void queryClient.prefetchQuery(herdrPanesQueryOptions);
    return queryClient.getQueryData(sessionDetailQueryOptions(params.id).queryKey);
  },
  errorComponent: SessionErrorComponent,
  head: ({ loaderData }) => ({
    meta: [{ title: sessionHeadTitle(loaderData) }],
  }),
});

/**
 * A pending session is not a missing session. `undefined` means the detail
 * query is still in flight; only `null` — what the API returns for an unknown
 * id — is a genuine 404.
 */
export function sessionHeadTitle(detail: { title: string } | null | undefined): string {
  if (detail === undefined) return "Loading session…";
  if (detail === null) return "Session Not Found";
  return detail.title;
}

function SessionErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const message = error instanceof Error ? error.message : "Failed to load session";

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold text-red-600 dark:text-red-400">
        Failed to load session
      </h1>
      <pre className="mt-3 max-w-2xl overflow-auto rounded-md border border-border bg-surface-0 p-3 font-mono text-sm text-t6">
        {message}
      </pre>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-accent-100 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-100/80"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={() => router.navigate({ to: "/sessions" })}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-secondary hover:bg-surface-0"
        >
          Back to sessions
        </button>
      </div>
    </div>
  );
}

/**
 * `head` runs with the loader's synchronous snapshot of the detail cache, so a
 * cold visit titles the tab "Loading session…". Re-run this route's loader once
 * the query lands so the tab picks up the real title.
 */
function useSessionHeadTitle(sessionId: string): void {
  const router = useRouter();
  const loaderData = Route.useLoaderData();
  const { data: detail } = useQuery(sessionDetailQueryOptions(sessionId));

  useEffect(() => {
    if (detail === undefined) return;
    if (sessionHeadTitle(loaderData) === sessionHeadTitle(detail)) return;
    void router.invalidate({ filter: (match) => match.routeId === Route.id });
  }, [detail, loaderData, router]);
}

function SessionRouteComponent() {
  const params = Route.useParams();
  useSessionHeadTitle(params.id);

  return <SessionPage sessionId={params.id} />;
}
