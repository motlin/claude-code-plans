import type {ReactNode} from "react";

import {BADGE_CLASS} from "./attachment-tile-classes";

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
export function ExcerptQuote({text, label, badge}: {text: string; label?: string; badge?: ReactNode})
{
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col justify-between gap-xs">
			<div className="flex min-h-0 min-w-0 gap-xs">
				<span aria-hidden="true" className="w-[3px] shrink-0 self-stretch rounded-full bg-border" />
				<blockquote
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
