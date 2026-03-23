export function LoadingBars() {
	return (
		<div className="space-y-1.5 py-1">
			<div className="h-3 w-3/4 animate-pulse rounded bg-bg-300/50" />
			<div className="h-3 w-1/2 animate-pulse rounded bg-bg-300/50" />
			<div className="h-3 w-2/3 animate-pulse rounded bg-bg-300/50" />
		</div>
	);
}
