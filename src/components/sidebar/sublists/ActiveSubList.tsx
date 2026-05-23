import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { activeSessionsQueryOptions } from "../../../lib/api/sessions";
import { LoadingBars } from "../primitives/LoadingBars";
import { useSettings } from "../../settings-provider";

export function ActiveSubList() {
  const { settings } = useSettings();
  const activeTimeoutMs = settings.activeTimeoutSec * 1000;
  const { data: sessions } = useQuery(activeSessionsQueryOptions(activeTimeoutMs));

  if (sessions === undefined) {
    return (
      <div className="pl-10">
        <LoadingBars />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="pl-10 px-2 py-1 text-[10px] italic text-text-400">No active sessions</div>
    );
  }

  return (
    <div className="pl-10">
      {sessions.map((session) => (
        <Link
          key={session.sessionId}
          to="/session/$id"
          params={{ id: session.sessionId }}
          className="mb-px flex items-center gap-2 rounded-[4px] px-2 py-1 text-xs text-text-500 no-underline transition-colors hover:bg-bg-300/50 hover:text-text-200"
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          <span className="truncate">{session.projectName}</span>
        </Link>
      ))}
    </div>
  );
}
