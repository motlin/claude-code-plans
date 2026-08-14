import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Info, MessagesSquare } from "lucide-react";
import { HerdrStatusIndicator } from "../components/herdr-status-indicator";
import { NeedsReviewMarker, SessionReviewAction } from "../components/session-reviewed-toggle";
import { StatusDot } from "../components/sidebar/primitives/StatusDot";
import { sessionQueryKeys } from "../lib/api/sessions";
import { terminalPlacementsQueryOptions } from "../lib/api/terminal-placements";
import { updateSessionViewedState } from "../lib/api/viewed-state";
import { splitTerminalTitleGlyph } from "../lib/herdr/terminal-title";

export const Route = createFileRoute("/herdr/")({
  component: HerdrPage,
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(terminalPlacementsQueryOptions),
  head: () => ({
    meta: [{ title: "Herdr" }],
  }),
});

const TRACKED_CLAUDE_SCOPE =
  "This page lists Herdr panes linked to indexed Claude transcripts. It intentionally excludes Codex sessions and shell panes that are not linked to a Claude transcript.";

/**
 * Every column but the title is fixed-width, and the trailing review-action
 * column is reserved even when a row has nothing to review, so the glyphs,
 * status dots, status words, and transcript icons line up down the whole list.
 *
 * Clicking the wide title cell opens the pane's live terminal, matching where
 * the workspace rail sends the same pane; the transcript is the secondary
 * affordance in the trailing icon cell.
 */
const HERDR_ROW_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_5rem_8.5rem_2rem_9rem] items-center rounded-md border border-border";

const TMUX_ROW_COLUMNS =
  "grid grid-cols-[0.625rem_2.75rem_2.5rem_minmax(0,1fr)_minmax(0,8rem)_auto] items-center gap-2 rounded-md border border-border p-3 no-underline transition-colors hover:bg-surface-0/50";

function HerdrEmptyState() {
  return (
    <div className="mx-auto mt-8 max-w-lg rounded-md border border-border p-6 text-sm text-t6">
      <p className="text-primary">No terminal placements are linked to Claude sessions yet.</p>
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
          <code className="rounded bg-surface-0/60 px-1 py-0.5 text-xs">
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
    <span className="ml-auto flex shrink-0 gap-1 text-[10px] text-t6">
      {labels.length === 0
        ? "placement only"
        : labels.map((label) => (
            <span key={label} className="rounded bg-surface-0/60 px-1.5 py-0.5">
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

  const markReviewed = async (sessionId: string, messageIndex: number): Promise<void> => {
    const viewedState = await updateSessionViewedState(sessionId, "reviewed", messageIndex);
    queryClient.setQueryData(terminalPlacementsQueryOptions.queryKey, (previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        placements: previous.placements.map((placement) =>
          placement.provider === "herdr" && placement.sessionId === sessionId
            ? {
                ...placement,
                herdrPane: { ...placement.herdrPane, viewedState },
              }
            : placement,
        ),
      };
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["terminal", "placements"] }),
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.detail(sessionId) }),
    ]);
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Herdr</h1>
        <span className="text-sm text-t6">{placements.length} tracked Claude sessions</span>
        <span
          role="img"
          aria-label={TRACKED_CLAUDE_SCOPE}
          title={TRACKED_CLAUDE_SCOPE}
          className="text-t6"
        >
          <Info aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs text-t6">(live updates via SSE)</span>
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
                  className={TMUX_ROW_COLUMNS}
                >
                  <StatusDot active={placement.active} />
                  <span className="sr-only">
                    {placement.active ? "Tmux window active" : "Tmux window not active"}
                  </span>
                  <span className="rounded bg-surface-0/60 px-1.5 py-0.5 text-center text-[10px] text-t6">
                    tmux
                  </span>
                  <span className="tabular-nums text-sm text-t6">
                    #{placement.tmuxWindow.windowIndex}
                  </span>
                  <span className="truncate text-sm font-medium text-primary">
                    {placement.displayName}
                  </span>
                  <span className="truncate text-xs text-t6">
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
            const { glyph, title } = splitTerminalTitleGlyph(placement.displayName);
            return (
              <div
                key={`herdr:${placement.scopeHandle}:${placement.paneHandle}:${placement.sessionId}`}
                className={HERDR_ROW_COLUMNS}
              >
                <Link
                  to="/herdr/terminal/$sessionId"
                  params={{ sessionId: placement.sessionId }}
                  aria-label={`Open live read-only terminal for ${placement.displayName}`}
                  title={`Open live read-only terminal for ${placement.displayName}. ${technicalDetails}`}
                  className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-1.5 rounded-md p-3 no-underline transition-colors hover:bg-surface-0/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
                >
                  <span className="sr-only">
                    {placement.active ? "Herdr pane focused" : "Herdr pane not focused"}
                  </span>
                  <span aria-hidden="true" className="truncate text-sm text-t6">
                    {glyph}
                  </span>
                  <span className="truncate text-sm font-medium text-primary">{title}</span>
                </Link>
                <HerdrStatusIndicator status={pane.agentStatus} />
                <NeedsReviewMarker
                  needsReview={!pane.viewedState.viewedAnywhere}
                  newMessageCount={pane.viewedState.newMessageCount}
                />
                <Link
                  to="/session/$id"
                  params={{ id: placement.sessionId }}
                  className="flex size-8 items-center justify-center justify-self-center rounded-md text-t6 transition-colors hover:bg-surface-0/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
                  title={`Open session transcript for ${placement.displayName}`}
                  aria-label={`Open session transcript for ${placement.displayName}`}
                >
                  <MessagesSquare aria-hidden="true" className="h-4 w-4" />
                </Link>
                <div className="justify-self-end">
                  {!pane.viewedState.viewedAnywhere && (
                    <SessionReviewAction
                      onReview={() =>
                        markReviewed(placement.sessionId, pane.viewedState.currentMessageIndex)
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
