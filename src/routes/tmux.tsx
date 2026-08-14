import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { tmuxWindowsQueryOptions } from "../lib/api/tmux";
import { StatusDot } from "../components/sidebar/primitives/StatusDot";
import { ListPageHeader } from "../components/list-page-header";

export const Route = createFileRoute("/tmux")({
  component: TmuxWindowsPage,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(tmuxWindowsQueryOptions),
  head: () => ({
    meta: [{ title: "Tmux Windows" }],
  }),
});

function TmuxEmptyState() {
  return (
    <div className="mx-auto mt-8 max-w-lg rounded-md border border-border p-6 text-sm text-t6">
      <p className="text-primary">No tmux windows are linked to Claude sessions yet.</p>
      <p className="mt-3">
        This live view only shows windows once a session reports its pane. To enable it:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Run Claude Code <span className="font-medium text-primary">inside tmux</span> so{" "}
          <code className="rounded bg-surface-0/60 px-1 py-0.5 text-xs">TMUX</code> and{" "}
          <code className="rounded bg-surface-0/60 px-1 py-0.5 text-xs">TMUX_PANE</code> are set.
        </li>
        <li>
          Re-install the hooks from{" "}
          <Link to="/setup" className="text-accent-100 hover:underline">
            Setup
          </Link>{" "}
          so the pane variables are forwarded to the browser.
        </li>
        <li>Submit a prompt in a live session — its window appears here automatically.</li>
      </ul>
    </div>
  );
}

function TmuxWindowsPage() {
  const { data: windows } = useSuspenseQuery(tmuxWindowsQueryOptions);

  return (
    <div>
      <ListPageHeader title="Tmux Windows" count={windows.length} itemLabel="window" />

      {windows.length === 0 ? (
        <TmuxEmptyState />
      ) : (
        <div className="mt-4 space-y-1">
          {windows.map((win) => (
            <Link
              key={win.tmuxPane}
              to="/session/$id"
              params={{ id: win.sessionId }}
              className="block rounded-md border border-border p-3 no-underline transition-colors hover:bg-surface-0/50"
            >
              <div className="flex items-center gap-2">
                <StatusDot active={win.windowActive} />
                <span className="shrink-0 tabular-nums text-sm text-t6">#{win.windowIndex}</span>
                <span className="truncate text-sm font-medium text-primary">{win.windowName}</span>
                <span className="ml-auto truncate text-xs text-t6">{win.projectName}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
