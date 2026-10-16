/** The awaiting card's title, shared by the loading skeleton and the loaded body. */
export function AwaitingTitle({title, titleId}: {title: string; titleId: string}) {
	return (
		<div className="px-4 pt-2.5">
			<span
				id={titleId}
				data-card-title
				className="line-clamp-2 text-[15px]/[20px] font-[580] text-primary [overflow-wrap:anywhere]"
			>
				{title}
			</span>
		</div>
	);
}

/** Upstream's loading skeleton: three bars, the last one a reply box tall. */
export function AwaitingBodySkeleton({title, titleId}: {title: string; titleId: string}) {
	return (
		<>
			<AwaitingTitle title={title} titleId={titleId} />
			<div aria-hidden className="flex flex-col gap-1.25 px-4 py-2.5">
				<span className="h-3 w-20 rounded bg-alpha-1" />
				<span className="h-4 w-full rounded bg-alpha-1" />
				<span className="h-[calc(1lh+8px)] w-full rounded-lg bg-alpha-1" />
			</div>
		</>
	);
}
