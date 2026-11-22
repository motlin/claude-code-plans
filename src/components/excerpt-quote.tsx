import {type ReactNode, useId, useMemo} from "react";

import {BADGE_CLASS} from "./attachment-tile-classes";
import {Tooltip} from "./ui/tooltip";

const QUOTE_MAX_GRAPHEMES = 240;

const graphemes = new Intl.Segmenter(
	undefined,
	{
		granularity: "grapheme",
	},
);

/** Upstream's quote text: whitespace collapsed to single spaces, capped at 240 graphemes with an ellipsis. */
function quoteText(text: string): string
{
	const collapsed = text.replace(/\s+/g, " ").trim();
	const parts = Array.from(graphemes.segment(collapsed), ({segment}) => segment);
	return parts.length <= QUOTE_MAX_GRAPHEMES ? collapsed : `${parts.slice(0, QUOTE_MAX_GRAPHEMES - 1).join("")}…`;
}

/**
 * Upstream's quote tile body: a rail beside the clamped text, over its badge (five lines above a badge,
 * six without one). `badge` replaces the plain label badge, as the sent tiles' hinted badge does.
 */
export function ExcerptQuote({
	text,
	label,
	badge,
	quoteId,
}: {
	text: string;
	label?: string;
	badge?: ReactNode;
	/** The blockquote's id, for a CardLink that it describes. */
	quoteId?: string;
})
{
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col justify-between gap-xs">
			<div className="flex min-h-0 min-w-0 gap-xs">
				<span aria-hidden="true" className="w-[3px] shrink-0 self-stretch rounded-full bg-border" />
				<blockquote
					id={quoteId}
					dir="auto"
					className={`min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-caption font-normal leading-tight text-secondary ${label === undefined ? "line-clamp-6" : "line-clamp-5"}`}
				>
					{quoteText(text)}
				</blockquote>
			</div>
			{label !== undefined &&
				(badge ?? (
					<span data-cds="Badge" className={BADGE_CLASS}>
						{label}
					</span>
				))}
		</div>
	);
}

/** Upstream `Ig`'s extra classes for a badge that carries a hint: focusable by keyboard, hoverable only by fine pointers. */
const HINT_BADGE_CLASS =
	"pointer-events-auto outline-none focus-visible:shadow-focus pointer-coarse:pointer-events-none";

/**
 * Upstream's xs Badge in a composer Quote row: the nested control height, neutral fill and the fizzy outline-badge
 * paint (9px radius, 1px transparent border); its pad-sm inline padding already computes upstream's 6px.
 */
const ROW_BADGE_CLASS =
	"inline-flex items-center gap-1 align-middle h-control-nested whitespace-nowrap rounded-badge-outline border border-transparent px-sm font-sans text-caption font-medium leading-[round(1.25em,1px)] min-w-0 max-w-full bg-neutral text-secondary";

/**
 * Upstream `Ig`: a badge whose hint shows in a top tooltip on hover or keyboard focus, and describes it.
 * `id` and `hintId` let a tile's CardLink point at the badge and its hint too. `row` draws a Quote row's xs
 * Badge, capped at 40% of the row, with the hint wrapped to break inside the tooltip.
 */
export function HintBadge({
	badge,
	hint,
	id,
	hintId,
	row = false,
}: {
	badge: string;
	hint: string;
	id?: string;
	hintId?: string;
	row?: boolean;
})
{
	const ownHintId = useId();
	const describedBy = hintId ?? ownHintId;
	const content = useMemo(
		() =>
			row ? (
				<span className="min-w-0 break-words">
					<bdi>{hint}</bdi>
				</span>
			) : (
				<bdi>{hint}</bdi>
			),
		[hint, row],
	);
	return (
		<>
			<Tooltip
				content={content}
				side="top"
				className={row ? "min-w-0 max-w-[40%] shrink-0" : "min-w-0 max-w-full self-start"}
			>
				<span
					id={id}
					data-cds="Badge"
					data-size={row ? "xs" : undefined}
					role="img"
					aria-label={badge}
					// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's hinted badge is a Tab stop so the keyboard can open its tooltip
					tabIndex={0}
					aria-describedby={describedBy}
					className={`${row ? ROW_BADGE_CLASS : BADGE_CLASS} ${HINT_BADGE_CLASS}`}
				>
					<span className="pb-[0.05em] min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap">
						<bdi>{badge}</bdi>
					</span>
				</span>
			</Tooltip>
			<span id={describedBy} hidden>
				<bdi>{hint}</bdi>
			</span>
		</>
	);
}
