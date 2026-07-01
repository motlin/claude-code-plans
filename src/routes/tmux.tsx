import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { tmuxWindowsQueryOptions } from "../lib/api/tmux";
import { StatusDot } from "../components/sidebar/primitives/StatusDot";

export const Route = createFileRoute("/tmux")({
  component: TmuxWindowsPage,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(tmuxWindowsQueryOptions),
  head: () => ({
    meta: [{ title: "Tmux Windows" }],
  }),
});

function TmuxWindowsPage() {
  const { data: windows } = useSuspenseQuery(tmuxWindowsQueryOptions);

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Tmux Windows</h1>
        <span className="text-sm text-text-500">{windows.length} windows</span>
      </div>

      {windows.length === 0 ? (
        <p className="mt-8 text-center text-text-500">No tmux windows linked to Claude sessions</p>
      ) : (
        <div className="mt-4 space-y-1">
          {windows.map((win) => (
            <Link
              key={win.tmuxPane}
              to="/session/$id"
              params={{ id: win.sessionId }}
              className="block rounded-md border border-border-300/15 p-3 no-underline transition-colors hover:bg-bg-200/50"
            >
              <div className="flex items-center gap-2">
                <StatusDot active={win.windowActive} />
                <span className="shrink-0 tabular-nums text-sm text-text-400">
                  #{win.windowIndex}
                </span>
                <span className="truncate text-sm font-medium text-text-000">{win.windowName}</span>
                <span className="ml-auto truncate text-xs text-text-500">{win.projectName}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
