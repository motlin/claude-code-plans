import { Link } from "@tanstack/react-router";
import { MessagesSquare, Monitor } from "lucide-react";

/**
 * `/herdr/terminal/$sessionId` and `/session/$id` are two views of the same
 * Claude session — the same UUID under two different param names — so each side
 * links to the other. Only these two components know that, which keeps the
 * param-name mismatch in one place.
 */

export function LiveTerminalLink({
  sessionId,
  sessionTitle,
  hasLivePane,
}: {
  sessionId: string;
  sessionTitle: string;
  hasLivePane: boolean;
}) {
  // Without a live pane `/api/herdr/observe` has no target to resolve and the
  // terminal page errors out, so a finished session gets no link at all.
  if (!hasLivePane) return null;

  const label = `Open live read-only terminal for ${sessionTitle}`;
  return (
    <Link
      to="/herdr/terminal/$sessionId"
      params={{ sessionId }}
      className="shrink-0 text-text-500 transition-colors hover:text-text-000"
      aria-label={label}
      title={label}
    >
      <Monitor aria-hidden="true" className="h-3.5 w-3.5" />
    </Link>
  );
}

export function SessionTranscriptLink({ sessionId }: { sessionId: string }) {
  const label = `Open session transcript for ${sessionId}`;
  return (
    <Link
      to="/session/$id"
      params={{ id: sessionId }}
      className="ml-auto flex size-8 items-center justify-center rounded-md text-text-500 transition-colors hover:bg-bg-200/50 hover:text-text-000 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-100"
      aria-label={label}
      title={label}
    >
      <MessagesSquare aria-hidden="true" className="h-4 w-4" />
    </Link>
  );
}
