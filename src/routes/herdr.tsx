import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { StatusDot } from "../components/sidebar/primitives/StatusDot";
import { herdrPanesQueryOptions } from "../lib/api/herdr";

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
  const panes = data.panes;

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
            <Link
              key={pane.terminalId}
              to="/session/$id"
              params={{ id: pane.sessionId }}
              className="block rounded-md border border-border-300/15 p-3 no-underline transition-colors hover:bg-bg-200/50"
            >
              <div className="flex items-center gap-2">
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
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
