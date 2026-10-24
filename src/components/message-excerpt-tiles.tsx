import type {AttachSnippet} from "../lib/attach-markers";
import {BADGE_CLASS, CARD_BODY_CLASS, CARD_CLASS, CARD_FILL_CLASS} from "./attachment-tile-classes";

/** A sent tile drops the composer tile's remove button and focus ring and stays selectable. */
const SENT_TILE_CLASS = "group/tile relative isolate size-[7.5rem] shrink-0 rounded-r7 self-end select-text";

/** Upstream's quote tile body: a rail beside the five-line-clamped text, over its badge. */
export function ExcerptQuote({text, label}: {text: string; label: string}) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col justify-between gap-1.5">
			<div className="flex min-h-0 min-w-0 gap-1.5">
				<span aria-hidden="true" className="w-[3px] shrink-0 self-stretch rounded-full bg-border" />
				<blockquote
					dir="auto"
					className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-caption font-normal leading-tight text-secondary line-clamp-5"
				>
					{text}
				</blockquote>
			</div>
			<span data-cds="Badge" className={BADGE_CLASS}>
				{label}
			</span>
		</div>
	);
}

/**
 * Upstream's sent-message cds MessageAttachments row: one Excerpt quote tile per
 * `<!-- attach -->` snippet the prompt carried, right-aligned above the bubble.
 */
export function MessageExcerptTiles({snippets}: {snippets: readonly AttachSnippet[]}) {
	if (snippets.length === 0) return null;
	return (
		<div
			data-cds="MessageAttachments"
			data-fit="natural"
			className="flex w-full flex-wrap gap-1.5 justify-end items-end empty:hidden"
		>
			{snippets.map((snippet, index) => (
				// oxlint-disable-next-line react/no-array-index-key -- snippets have no identity beyond their order in the prompt
				<div key={index} data-cds="MessageAttachmentsQuote" data-cds-attachment="" className={SENT_TILE_CLASS}>
					<div data-cds="Card" data-size="xs" className={CARD_CLASS}>
						<span aria-hidden="true" className={CARD_FILL_CLASS} />
						<div data-cds-card-body="" className={CARD_BODY_CLASS}>
							<ExcerptQuote text={snippet.text} label={snippet.label ?? "Excerpt"} />
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
