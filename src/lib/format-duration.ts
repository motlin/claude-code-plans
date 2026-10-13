export function formatDuration(ms: number): string {
	if (ms < 1000) return "< 1s";
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60000);
	const secs = Math.round((ms % 60000) / 1000);
	return `${mins}m ${secs}s`;
}
