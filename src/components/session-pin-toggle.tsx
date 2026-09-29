import { pin, unpin, usePins } from "../lib/pin-store";

/** Header star toggle backed by this browser's pins (src/lib/pin-store.ts). */
export function SessionPinToggle({ sessionId }: { sessionId: string }) {
  const pinned = usePins().isPinned(sessionId);
  const label = pinned ? "Unstar session" : "Star session";
  return (
    <button
      type="button"
      onClick={() => (pinned ? unpin(sessionId) : pin(sessionId))}
      className="shrink-0 cursor-pointer text-t6 transition-colors hover:text-warning-000"
      title={label}
      aria-label={label}
      aria-pressed={pinned}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill={pinned ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        style={{ color: pinned ? "rgb(234, 179, 8)" : undefined }}
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}
