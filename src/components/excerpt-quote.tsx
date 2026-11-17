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
 * Upstream `Ig`: a badge whose hint shows in a top tooltip on hover or keyboard focus, and describes it.
 * `id` and `hintId` let a tile's CardLink point at the badge and its hint too.
 */
export function HintBadge({badge, hint, id, hintId}: {badge: string; hint: string; id?: string; hintId?: string})
{
	const ownHintId = useId();
	const describedBy = hintId ?? ownHintId;
	const content = useMemo(() => <bdi>{hint}</bdi>, [hint]);
	return (
		<>
			<Tooltip content={content} side="top" className="min-w-0 max-w-full self-start">
				<span
					id={id}
					data-cds="Badge"
					role="img"
					aria-label={badge}
					// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's hinted badge is a Tab stop so the keyboard can open its tooltip
					tabIndex={0}
					aria-describedby={describedBy}
					className={`${BADGE_CLASS} ${HINT_BADGE_CLASS}`}
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
