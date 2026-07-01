import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { tmuxWindowsQueryOptions } from "../../../lib/api/tmux";
import { LoadingBars } from "../primitives/LoadingBars";
import { StatusDot } from "../primitives/StatusDot";

export function TmuxWindowsSubList() {
  const { data: windows } = useQuery(tmuxWindowsQueryOptions);

  if (windows === undefined) {
    return (
      <div className="pl-10">
        <LoadingBars />
      </div>
    );
  }

  if (windows.length === 0) {
    return <div className="pl-10 px-2 py-1 text-[10px] italic text-text-400">No tmux windows</div>;
  }

  return (
    <div className="pl-10">
      {windows.map((win) => (
        <Link
          key={win.tmuxPane}
          to="/session/$id"
          params={{ id: win.sessionId }}
          className="mb-px flex items-center gap-2 rounded-[4px] px-2 py-1 text-xs text-text-500 no-underline transition-colors hover:bg-bg-300/50 hover:text-text-200"
        >
          <StatusDot active={win.windowActive} size="sm" />
          <span className="shrink-0 tabular-nums text-text-400">#{win.windowIndex}</span>
          <span className="truncate">{win.windowName}</span>
        </Link>
      ))}
    </div>
  );
}
