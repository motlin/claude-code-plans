type StatusDotProps = {
  active: boolean;
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

/**
 * Live-session status indicator: a pulsing green dot when active, a small muted
 * dot when idle. `sm` suits the sidebar sublists, `md` the full-page lists.
 */
export function StatusDot({ active, size = "md" }: StatusDotProps) {
  const outer = OUTER_SIZE[size];

  if (active) {
    return (
      <span className={`relative flex ${outer} shrink-0`}>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className={`relative inline-flex ${outer} rounded-full bg-green-500`} />
      </span>
    );
  }

  return (
    <span className={`flex ${outer} shrink-0 items-center justify-center`}>
      <span className={`${IDLE_INNER_SIZE[size]} rounded-full bg-text-400/40`} />
    </span>
  );
}
