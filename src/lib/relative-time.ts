export function formatRelativeTimeFromIso(iso: string): string {
	const diffMs = Date.now() - new Date(iso).getTime();
	const seconds = Math.floor(diffMs / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

/**
 * claude.ai/code's narrow RelativeTime: "now", "47m ago", "2h ago", "3d ago"; never absolute. The unit comes from the
 * exact elapsed time and its count is rounded, so 1h52m reads "2h ago" as upstream shows it.
 */
export function formatNarrowRelativeTime(timestamp: number, now: number): string {
	const minutes = (now - timestamp) / 60_000;
	if (minutes < 1) return "now";
	if (minutes < 60) return `${Math.round(minutes)}m ago`;
	const hours = minutes / 60;
	if (hours < 24) return `${Math.round(hours)}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}
