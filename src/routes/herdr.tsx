import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, EyeOff, Info, Monitor } from "lucide-react";
import { HerdrStatusIndicator } from "../components/herdr-status-indicator";
import { StatusDot } from "../components/sidebar/primitives/StatusDot";
import { sessionQueryKeys } from "../lib/api/sessions";
import { terminalPlacementsQueryOptions } from "../lib/api/terminal-placements";
import { updateSessionViewedState } from "../lib/api/viewed-state";

export const Route = createFileRoute("/herdr")({
  component: HerdrPage,
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(terminalPlacementsQueryOptions),
  head: () => ({
    meta: [{ title: "Herdr" }],
  }),
});

const TRACKED_CLAUDE_SCOPE =
  "This page lists Herdr panes linked to indexed Claude transcripts. It intentionally excludes Codex sessions and shell panes that are not linked to a Claude transcript.";

function HerdrEmptyState() {
  return (
    <div className="mx-auto mt-8 max-w-lg rounded-md border border-border-300/15 p-6 text-sm text-text-500">
      <p className="text-text-000">No terminal placements are linked to Claude sessions yet.</p>
      <p className="mt-3">Run Claude Code inside tmux or herdr, then:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Re-install the hooks from{" "}
          <Link to="/setup" className="text-accent-100 hover:underline">
            Setup
          </Link>{" "}
          so terminal environment variables are forwarded to ccp.
        </li>
        <li>
          Submit a prompt in the live session so its placement enters the active-session store.
        </li>
        <li>
          For herdr identity cross-checks, optionally run{" "}
          <code className="rounded bg-bg-200/60 px-1 py-0.5 text-xs">
            herdr integration install claude
          </code>{" "}
          to add herdr&apos;s authoritative session-id cross-check.
        </li>
      </ul>
    </div>
  );
}

function CapabilityBadges({
  capabilities,
  writesEnabled,
}: {
  capabilities: {
    supportsWrite: boolean;
    supportsEvents: boolean;
    supportsObserve: boolean;
  };
  writesEnabled: boolean;
}) {
  const labels = [
    capabilities.supportsWrite ? (writesEnabled ? "write" : "write disabled") : null,
    capabilities.supportsEvents ? "events" : null,
    capabilities.supportsObserve ? "observe" : null,
  ].filter((label): label is string => label !== null);

  return (
    <span className="ml-auto flex shrink-0 gap-1 text-[10px] text-text-500">
      {labels.length === 0
        ? "placement only"
        : labels.map((label) => (
            <span key={label} className="rounded bg-bg-200/60 px-1.5 py-0.5">
              {label}
            </span>
          ))}
    </span>
  );
}

function HerdrPage() {
  const { data } = useSuspenseQuery(terminalPlacementsQueryOptions);
  const queryClient = useQueryClient();
  const placements = data.placements;

  const setViewed = async (
    sessionId: string,
    action: "reviewed" | "unreviewed",
    messageIndex: number,
  ): Promise<void> => {
    await updateSessionViewedState(sessionId, action, messageIndex);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["terminal", "placements"] }),
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.detail(sessionId) }),
    ]);
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Herdr</h1>
        <span className="text-sm text-text-500">{placements.length} tracked Claude sessions</span>
        <span
          role="img"
          aria-label={TRACKED_CLAUDE_SCOPE}
          title={TRACKED_CLAUDE_SCOPE}
          className="text-text-500"
        >
          <Info aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs text-text-500">(live updates via SSE)</span>
      </div>

      {placements.length === 0 ? (
        <HerdrEmptyState />
      ) : (
        <div className="mt-4 space-y-1">
          {placements.map((placement) => {
            if (placement.provider === "tmux") {
              return (
                <Link
                  key={`tmux:${placement.scopeHandle}:${placement.paneHandle}:${placement.sessionId}`}
                  to="/session/$id"
                  params={{ id: placement.sessionId }}
                  className="flex items-center gap-2 rounded-md border border-border-300/15 p-3 no-underline transition-colors hover:bg-bg-200/50"
                >
                  <StatusDot active={placement.active} />
                  <span className="sr-only">
                    {placement.active ? "Tmux window active" : "Tmux window not active"}
                  </span>
                  <span className="shrink-0 rounded bg-bg-200/60 px-1.5 py-0.5 text-[10px] text-text-500">
                    tmux
                  </span>
                  <span className="shrink-0 tabular-nums text-sm text-text-400">
                    #{placement.tmuxWindow.windowIndex}
                  </span>
                  <span className="truncate text-sm font-medium text-text-000">
                    {placement.displayName}
                  </span>
                  <span className="truncate text-xs text-text-500">
                    {placement.tmuxWindow.projectName}
                  </span>
                  <CapabilityBadges
                    capabilities={placement.capabilities}
                    writesEnabled={data.writesEnabled}
                  />
                </Link>
              );
            }

            const pane = placement.herdrPane;
            const capabilityLabels = [
              placement.capabilities.supportsWrite
                ? data.writesEnabled
                  ? "write"
                  : "write disabled"
                : null,
              placement.capabilities.supportsEvents ? "events" : null,
              placement.capabilities.supportsObserve ? "observe" : null,
            ].filter((label): label is string => label !== null);
            const technicalDetails = `Workspace ${pane.workspaceId} · Pane ${pane.paneId} · Terminal ${pane.terminalId} · Capabilities: ${capabilityLabels.length === 0 ? "placement only" : capabilityLabels.join(", ")}`;
            return (
              <div
                key={`herdr:${placement.scopeHandle}:${placement.paneHandle}:${placement.sessionId}`}
                className="flex items-center rounded-md border border-border-300/15"
              >
                <Link
                  to="/session/$id"
                  params={{ id: placement.sessionId }}
                  aria-label={`Open session transcript for ${placement.displayName}`}
                  title={`Open session transcript for ${placement.displayName}. ${technicalDetails}`}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-3 no-underline transition-colors hover:bg-bg-200/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
                >
                  <span className="sr-only">
                    {placement.active ? "Herdr pane focused" : "Herdr pane not focused"}
                  </span>
                  <span className="truncate text-sm font-medium text-text-000">
                    {placement.displayName}
                  </span>
                  <HerdrStatusIndicator status={pane.agentStatus} />
                  {!pane.viewedState.viewedAnywhere && (
                    <span className="shrink-0 text-xs text-warning-000">
                      review · {pane.viewedState.newMessageCount} new
                    </span>
                  )}
                </Link>
                <Link
                  to="/herdr/terminal/$sessionId"
                  params={{ sessionId: placement.sessionId }}
                  onClick={(event) => event.stopPropagation()}
                  className="mr-2 flex size-8 shrink-0 items-center justify-center rounded-md text-text-500 transition-colors hover:bg-bg-200/50 hover:text-text-000 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
                  title={`Open live read-only terminal for ${placement.displayName}`}
                  aria-label={`Open live read-only terminal for ${placement.displayName}`}
                >
                  <Monitor aria-hidden="true" className="h-4 w-4" />
                </Link>
                <button
                  type="button"
                  onClick={() =>
                    void setViewed(
                      placement.sessionId,
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
            );
          })}
        </div>
      )}
    </div>
  );
}
