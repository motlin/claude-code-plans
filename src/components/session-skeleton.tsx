import {Laptop} from "lucide-react";

const BAR_CLASS = "animate-pulse bg-fill-ghost-hover";

/** Upstream's paragraph bars, as widths of the column's 760px text area: three groups on a 20px pitch. */
const PARAGRAPH_WIDTHS = [
	["w-[95%]", "w-[99%]", "w-[91%]", "w-[57%]"],
	["w-[99%]", "w-[93%]", "w-[41%]"],
	["w-[96%]", "w-[89%]", "w-[65%]"],
];

/**
 * Upstream's pending session on an in-app switch: an 18px dot and title bar in
 * the header slot, then a right-aligned user bubble and three paragraphs of 8px
 * bars in the chat column, inset by the same scrollbar gutters as the
 * transcript that replaces it. A title the session list already knows takes
 * the bar's place, beside the device glyph, as upstream's header shows it.
 */
export function SessionSkeleton({title}: {title?: string | undefined} = {}) {
	return (
		<div data-testid="session-skeleton">
			<div data-skeleton-header="" className="flex items-center gap-[7px] px-[7px] pt-[6px]">
				{title === undefined ? (
					<>
						<div className={`size-[18px] shrink-0 rounded-full ${BAR_CLASS}`} />
						<div className="h-[18px] w-[190px] animate-pulse rounded bg-fill-ghost-hover" />
					</>
				) : (
					<>
						<Laptop aria-hidden="true" className="size-[18px] shrink-0 text-primary" />
						<span
							data-skeleton-title=""
							className="min-w-0 truncate text-[13px]/[19px] font-medium text-primary"
						>
							{title}
						</span>
					</>
				)}
			</div>
			<div className="overflow-y-auto [scrollbar-gutter:stable_both-edges]">
				<div className="chat-column mt-[56px] flex flex-col">
					<div
						data-skeleton-bubble=""
						className={`h-8 w-[288px] max-w-full self-end rounded-r7 ${BAR_CLASS}`}
					/>
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
		</div>
	);
}
