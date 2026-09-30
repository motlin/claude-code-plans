/**
 * Pane/window activity indicator for the herdr and tmux pages: a pulsing green
 * dot when active, a small muted dot when idle. Session rows use the upstream
 * `SessionStateIcon` (src/components/status-dot.tsx) instead.
 */
export function StatusDot({active}: {active: boolean}) {
	if (active) {
		return (
			<span className="relative flex h-2.5 w-2.5 shrink-0">
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
				<span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
			</span>
		);
	}

	return (
		<span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center">
			<span className="h-2 w-2 rounded-full bg-t6/40" />
		</span>
	);
}
