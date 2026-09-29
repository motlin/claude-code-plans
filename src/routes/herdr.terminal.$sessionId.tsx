import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TerminalPane } from "../components/panes/terminal-pane";
import { SessionTranscriptLink } from "../components/session-terminal-links";
import { applicationSettingsQueryOptions } from "../lib/api/application-settings";
import { herdrPanesQueryOptions } from "../lib/api/herdr";

export const Route = createFileRoute("/herdr/terminal/$sessionId")({
  component: HerdrTerminalPage,
  head: () => ({ meta: [{ title: "Live Herdr terminal" }] }),
});

/**
 * The full-bleed pop-out of a session's Terminal pane (upstream's "Open in
 * new window"): the same `TerminalPane`, placed standalone beside the rail.
 * Until herdr's pane list loads the Claude tab is assumed live; once it has
 * loaded without this session, the tab shows "Session ended".
 */
function HerdrTerminalPage() {
  const { sessionId } = Route.useParams();
  const herdr = useQuery(herdrPanesQueryOptions).data;
  const shells =
    useQuery({
      ...applicationSettingsQueryOptions,
      select: (settings) => settings.shellPaneEnabled,
    }).data ?? false;
  const livePane = herdr === undefined || herdr.panes.some((pane) => pane.sessionId === sessionId);

  return (
    <div className="flex h-[calc(100dvh-1rem)] min-h-96 flex-col gap-3 pb-4">
      <div className="flex items-center gap-3">
        <Link to="/herdr" className="text-sm text-t6 hover:text-primary">
          Herdr
        </Link>
        <span className="text-t6">/</span>
        <h1 className="text-lg font-semibold">Live terminal</h1>
        <SessionTranscriptLink sessionId={sessionId} />
      </div>
      <div className="min-h-0 flex-1">
        <TerminalPane
          sessionId={sessionId}
          availability={{
            livePane,
            interactive: livePane && (herdr?.writesEnabled ?? false),
            shells,
          }}
          claudeEnded={!livePane}
          standalone
        />
      </div>
    </div>
  );
}
