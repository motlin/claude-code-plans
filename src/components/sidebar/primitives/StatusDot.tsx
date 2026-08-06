import type { WaitHeat } from "../../../lib/session-state";

type StatusDotProps = {
  active: boolean;
  heat?: WaitHeat;
  size?: "sm" | "md";
};

const OUTER_SIZE = {
  sm: "h-2 w-2",
  md: "h-2.5 w-2.5",
} as const;

const IDLE_INNER_SIZE = {
  sm: "h-1.5 w-1.5",
  md: "h-2 w-2",
} as const;

const ACTIVE_COLORS = {
  "": {
    pulse: "bg-green-400",
    dot: "bg-green-500",
  },
  warm: {
    pulse: "bg-amber-400",
    dot: "bg-amber-500",
  },
  hot: {
    pulse: "bg-red-400",
    dot: "bg-red-500",
  },
} as const;

/**
 * Live-session status indicator: a pulsing green dot when active, a small muted
 * dot when idle. `sm` suits the sidebar sublists, `md` the full-page lists.
 */
export function StatusDot({ active, heat = "", size = "md" }: StatusDotProps) {
  const outer = OUTER_SIZE[size];

  if (active) {
    const color = ACTIVE_COLORS[heat];
    return (
      <span className={`relative flex ${outer} shrink-0`}>
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color.pulse} opacity-75`}
        />
        <span className={`relative inline-flex ${outer} rounded-full ${color.dot}`} />
      </span>
    );
  }

  return (
    <span className={`flex ${outer} shrink-0 items-center justify-center`}>
      <span className={`${IDLE_INNER_SIZE[size]} rounded-full bg-text-400/40`} />
    </span>
  );
}
