export function SessionSkeleton() {
	return (
		<div>
			<div className="flex h-8 items-center">
				<div className="h-5 w-1/3 animate-pulse rounded bg-fill-ghost-hover" />
			</div>
			<div className="mt-6 space-y-4" data-testid="session-skeleton">
				{[0, 1, 2, 3, 4, 5].map((row) => (
					<div key={row} className="rounded-lg border border-border p-4">
						<div className="h-3 w-24 animate-pulse rounded bg-fill-ghost-hover" />
						<div className="mt-3 h-3 w-full animate-pulse rounded bg-fill-ghost-hover" />
						<div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-fill-ghost-hover" />
					</div>
				))}
			</div>
		</div>
	);
}
