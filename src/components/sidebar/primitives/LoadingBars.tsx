export function LoadingBars() {
	return (
		<div className="space-y-1.5 py-1">
			<div className="h-3 w-3/4 animate-pulse rounded bg-fill-ghost-hover" />
			<div className="h-3 w-1/2 animate-pulse rounded bg-fill-ghost-hover" />
			<div className="h-3 w-2/3 animate-pulse rounded bg-fill-ghost-hover" />
		</div>
	);
}

/** Upstream's skeleton bar widths (`CJ`), cycled per row; a row's description bar takes the next width. */
const DESCRIBED_BAR_WIDTHS = ["68%", "54%", "44%"] as const;
const BAR_CLASS = "block animate-pulse rounded bg-fill-ghost-hover";

/**
 * Upstream's described skeleton rows (`y4`), shown while the list loads with Show ▸ Metadata on:
 * each placeholder is a two-line described row with a title bar and a shorter description bar.
 */
export function DescribedLoadingRows({rows = 3}: {rows?: number}) {
	return Array.from({length: rows}, (_, index) => (
		<div
			key={index}
			data-row=""
			data-described=""
			className="df-described-row flex flex-col items-stretch justify-center px-[var(--sb-row-px)]"
		>
			<span className="df-described-title flex min-w-0 items-center">
				<span
					className={BAR_CLASS}
					style={{width: DESCRIBED_BAR_WIDTHS[index % 3], height: "var(--sb-row-font)"}}
				/>
			</span>
			<span className="df-row-description flex min-w-0 items-center">
				<span
					className={BAR_CLASS}
					style={{width: DESCRIBED_BAR_WIDTHS[(index + 1) % 3], height: "var(--sb-group-font)"}}
				/>
			</span>
		</div>
	));
}
