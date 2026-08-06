import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { StatusDot } from "../components/sidebar/primitives/StatusDot";
import { herdrPanesQueryOptions } from "../lib/api/herdr";
import { updateSessionViewedState } from "../lib/api/viewed-state";

export const Route = createFileRoute("/herdr")({
  component: HerdrFleetPage,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(herdrPanesQueryOptions),
  head: () => ({
    meta: [{ title: "Herdr Fleet" }],
  }),
});

function HerdrEmptyState() {
  return (
    <div className="mx-auto mt-8 max-w-lg rounded-md border border-border-300/15 p-6 text-sm text-text-500">
      <p className="text-text-000">No herdr panes are linked to Claude sessions yet.</p>
      <p className="mt-3">Herdr is optional, so an empty fleet is expected until you enable it:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Run Claude Code <span className="font-medium text-text-000">inside a herdr pane</span> so{" "}
          <code className="rounded bg-bg-200/60 px-1 py-0.5 text-xs">HERDR_ENV</code> and{" "}
          <code className="rounded bg-bg-200/60 px-1 py-0.5 text-xs">HERDR_PANE_ID</code> are set.
        </li>
        <li>
          Re-install the hooks from{" "}
          <Link to="/setup" className="text-accent-100 hover:underline">
            Setup
          </Link>{" "}
          so those variables are forwarded to ccp.
        </li>
        <li>
          Optionally run{" "}
          <code className="rounded bg-bg-200/60 px-1 py-0.5 text-xs">
            herdr integration install claude
          </code>{" "}
          to add herdr&apos;s authoritative session-id cross-check.
        </li>
      </ul>
    </div>
  );
}

function HerdrFleetPage() {
  const { data } = useSuspenseQuery(herdrPanesQueryOptions);
  const queryClient = useQueryClient();
  const panes = data.panes;

  const setViewed = async (
    sessionId: string,
    action: "reviewed" | "unreviewed",
    messageIndex: number,
  ): Promise<void> => {
    await updateSessionViewedState(sessionId, action, messageIndex);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["herdr", "panes"] }),
      queryClient.invalidateQueries({ queryKey: ["sessions", sessionId] }),
    ]);
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Herdr Fleet</h1>
        <span className="text-sm text-text-500">{panes.length} panes</span>
        <span className="text-xs text-text-500">(live updates via SSE)</span>
      </div>

      {panes.length === 0 ? (
        <HerdrEmptyState />
      ) : (
        <div className="mt-4 space-y-1">
          {panes.map((pane) => (
            <div
              key={pane.terminalId}
              className="flex items-center rounded-md border border-border-300/15 transition-colors hover:bg-bg-200/50"
            >
              <Link
                to="/session/$id"
                params={{ id: pane.sessionId }}
                className="flex min-w-0 flex-1 items-center gap-2 p-3 no-underline"
              >
                <StatusDot active={pane.focused} />
                <span className="sr-only">
                  {pane.focused ? "Herdr pane focused" : "Herdr pane not focused"}
                </span>
                <span className="shrink-0 tabular-nums text-sm text-text-400">{pane.paneId}</span>
                <span className="truncate text-sm font-medium text-text-000">
                  {pane.terminalTitle ?? pane.foregroundCwd ?? pane.cwd ?? pane.terminalId}
                </span>
                <span className="ml-auto shrink-0 text-xs text-text-500">
                  herdr&apos;s view: {pane.agentStatus} (advisory)
                </span>
                {!pane.viewedState.viewedAnywhere && (
                  <span className="shrink-0 text-xs text-warning-000">
                    review · {pane.viewedState.newMessageCount} new
                  </span>
                )}
              </Link>
              <button
                type="button"
                onClick={() =>
                  void setViewed(
                    pane.sessionId,
                    pane.viewedState.viewedAnywhere ? "unreviewed" : "reviewed",
                    pane.viewedState.currentMessageIndex,
                  )
                }
                className="mr-3 shrink-0 cursor-pointer text-text-500 hover:text-text-000"
                title={pane.viewedState.viewedAnywhere ? "Mark unreviewed" : "Mark reviewed"}
              >
                {pane.viewedState.viewedAnywhere ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
