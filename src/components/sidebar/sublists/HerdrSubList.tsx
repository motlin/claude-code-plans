import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { terminalPlacementsQueryOptions } from "../../../lib/api/terminal-placements";
import { LoadingBars } from "../primitives/LoadingBars";
import { StatusDot } from "../primitives/StatusDot";

export function HerdrSubList({ activeItemId }: { activeItemId: string | null }) {
  const { data } = useQuery(terminalPlacementsQueryOptions);

  if (data === undefined) {
    return (
      <div className="pl-10">
        <LoadingBars />
      </div>
    );
  }

  const terminals = data.placements.filter((placement) => placement.provider === "herdr");
  if (terminals.length === 0) {
    return (
      <div className="pl-10 px-2 py-1 text-[10px] italic text-text-400">No live terminals</div>
    );
  }

  return (
    <div className="pl-10">
      {terminals.map((terminal) => {
        const isActive = terminal.sessionId === activeItemId;
        return (
          <Link
            key={`${terminal.scopeHandle}:${terminal.paneHandle}:${terminal.sessionId}`}
            to="/herdr/terminal/$sessionId"
            params={{ sessionId: terminal.sessionId }}
            className={`mb-px flex items-center gap-2 rounded-[4px] px-2 py-1 text-xs no-underline transition-colors ${
              isActive
                ? "bg-bg-300/50 font-medium text-text-000"
                : "text-text-500 hover:bg-bg-300/50 hover:text-text-200"
            }`}
          >
            <StatusDot active={terminal.active} size="sm" />
            <span className="truncate">{terminal.displayName}</span>
          </Link>
        );
      })}
    </div>
  );
}
