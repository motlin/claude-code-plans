import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { activeSessionsQueryOptions } from "../../../lib/api/sessions";
import {
  compareByStableCreation,
  compareByUrgency,
  displayState,
  waitHeat,
} from "../../../lib/session-state";
import { hasUnseenWork, subscribeUnseenWork } from "../../../lib/unread-store";
import { LoadingBars } from "../primitives/LoadingBars";
import { StatusDot } from "../primitives/StatusDot";
import { useSettings } from "../../settings-provider";

export function ActiveSubList() {
  const { settings } = useSettings();
  const [now, setNow] = useState(Date.now);
  const [, setUnseenWorkVersion] = useState(0);
  const activeTimeoutMs = settings.activeTimeoutSec * 1000;
  const { data: sessions } = useQuery(activeSessionsQueryOptions(activeTimeoutMs));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setUnseenWorkVersion((version) => version + 1);
    return subscribeUnseenWork(() => setUnseenWorkVersion((version) => version + 1));
  }, []);

  if (sessions === undefined) {
    return (
      <div className="pl-10">
        <LoadingBars />
      </div>
    );
  }

  if (sessions.length === 0) {
    return <div className="pl-10 px-2 py-1 text-[10px] italic text-t6">No active sessions</div>;
  }

  const displayedSessions = sessions.map((session) => ({
    ...session,
    displayState: displayState(session.state, hasUnseenWork(session.sessionId)),
  }));
  displayedSessions.sort((first, second) =>
    settings.sessionSort === "stable"
      ? compareByStableCreation(first, second)
      : compareByUrgency(
          { state: first.displayState, lastModified: first.lastModified },
          { state: second.displayState, lastModified: second.lastModified },
        ),
  );

  return (
    <div className="pl-10">
      {displayedSessions.map((session) => (
        <Link
          key={session.sessionId}
          to="/session/$id"
          params={{ id: session.sessionId }}
          className="mb-px flex items-center gap-2 rounded-r3 px-2 py-1 text-xs text-t6 no-underline transition-colors hover:bg-fill-ghost-hover hover:text-secondary"
        >
          <StatusDot
            active
            heat={waitHeat(session.displayState, session.blockedSince, now)}
            size="sm"
          />
          <span className="truncate">{session.projectName}</span>
        </Link>
      ))}
    </div>
  );
}
