import {Skeleton} from "../ui/skeleton";

/** Upstream's six placeholder rows: title and subtitle bar widths, in order. */
const ROW_WIDTHS = [
	["w-28", "w-3/5"],
	["w-36", "w-2/3"],
	["w-24", "w-1/2"],
	["w-32", "w-3/5"],
	["w-40", "w-2/3"],
	["w-28", "w-1/2"],
] as const;

/** Upstream's list-rows skeleton: a section-heading bar over six comfortable-density rows (the Settings dialog is comfortable). */
export function CustomizeListRowsSkeleton() {
	return (
		<div aria-hidden="true" className="flex flex-col">
			<div aria-hidden="true" data-testid="list-rows-skeleton-heading" className="flex min-h-7 items-center">
				<div className="flex h-lh max-w-full items-center text-[14px]/[20px] font-[580]">
					<Skeleton className="h-[1em] rounded w-32" />
				</div>
			</div>
			{ROW_WIDTHS.map(([title, subtitle], index) => (
				<div
					// oxlint-disable-next-line react/no-array-index-key -- a fixed, static list of placeholders
					key={index}
					aria-hidden="true"
					data-testid="list-rows-skeleton-row"
					className="flex items-center gap-4 -mx-3 self-stretch px-3 py-3"
				>
					<Skeleton className="size-9 shrink-0 rounded-card" />
					<div aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-0.5">
						<div className="flex h-lh max-w-full items-center text-body">
							<Skeleton className={`h-[1em] rounded ${title}`} />
						</div>
						<div className="flex h-lh max-w-full items-center text-footnote">
							<Skeleton className={`h-[1em] rounded ${subtitle}`} />
						</div>
					</div>
					<div aria-hidden="true" className="flex shrink-0 items-center gap-7">
						<div className="flex h-lh max-w-full items-center text-footnote">
							<Skeleton className="h-[1em] rounded w-10" />
						</div>
						<div className="size-8" />
					</div>
				</div>
			))}
		</div>
	);
}

/** A Customize section body while its list query is pending. */
export function CustomizeSectionSkeleton() {
	return (
		<div aria-busy="true" data-testid="customize-section-skeleton">
			<span role="status" className="sr-only">
				Loading
			</span>
			<CustomizeListRowsSkeleton />
		</div>
	);
}

/**
 * Upstream's cold-load Customize panel: the section header, then the list-rows
 * skeleton, inside the busy wrapper the dialog shows while the panel's module loads.
 */
export function CustomizePanelSkeleton({title}: {title: string}) {
	return (
		<div aria-busy="true" data-testid="settings-content-skeleton" className="relative flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 overflow-hidden">
				<div data-testid="customize-panel-skeleton" className="flex h-full min-h-0 flex-1 flex-col pt-1">
					<span role="status" className="sr-only">
						Loading
					</span>
					<header className="mx-auto w-full max-w-4xl px-5 flex shrink-0 flex-wrap items-end justify-between gap-x-3 gap-y-2">
						<div className="flex min-w-0 items-center gap-3">
							<h2 className="min-w-0 truncate text-[20px]/[25px] font-[580] text-primary">{title}</h2>
						</div>
					</header>
					<div aria-hidden="true" className="shrink-0 h-4" />
					<div
						aria-hidden="true"
						className="mx-auto w-full max-w-4xl px-5 flex min-h-0 flex-1 flex-col overflow-hidden pb-4"
					>
						<CustomizeListRowsSkeleton />
					</div>
				</div>
			</div>
		</div>
	);
}
