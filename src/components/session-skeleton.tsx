const BAR_CLASS = "animate-pulse bg-fill-ghost-hover";

/** Upstream's paragraph bars, as widths of the column's 760px text area: three groups on a 20px pitch. */
const PARAGRAPH_WIDTHS = [
	["w-[95%]", "w-[99%]", "w-[91%]", "w-[57%]"],
	["w-[99%]", "w-[93%]", "w-[41%]"],
	["w-[96%]", "w-[89%]", "w-[65%]"],
];

/**
 * Upstream's pending session on an in-app switch: a dot and title bar where the
 * header goes, then in the chat column a right-aligned user bubble and three
 * paragraphs of 8px bars.
 */
export function SessionSkeleton() {
	return (
		<div data-testid="session-skeleton">
			<div data-skeleton-header="" className="flex items-center gap-3 px-2 pt-6">
				<div className={`size-3 shrink-0 rounded-full ${BAR_CLASS}`} />
				<div className="h-3.5 w-[190px] animate-pulse rounded bg-fill-ghost-hover" />
			</div>
			<div className="chat-column mt-[52px] flex flex-col">
				<div data-skeleton-bubble="" className={`h-8 w-[288px] max-w-full self-end rounded-r7 ${BAR_CLASS}`} />
				<div className="mt-[47px] flex flex-col gap-[22px] px-2">
					{PARAGRAPH_WIDTHS.map((widths, group) => (
						<div key={group} data-skeleton-paragraph="" className="flex flex-col gap-3">
							{widths.map((width) => (
								<div key={width} className={`h-2 ${width} rounded ${BAR_CLASS}`} />
							))}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
