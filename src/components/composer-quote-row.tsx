import {type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, useId, useMemo, useState} from "react";
import {Reply, X} from "lucide-react";

import {HintBadge} from "./excerpt-quote";
import {Tooltip} from "./ui/tooltip";

/** Upstream's row Card corner: the composer field's radius less 4px. */
const ROW_RADIUS = "rounded-[calc(var(--radius-composer)-4px)]";

const ROW_CARD_CLASS = `group/card relative isolate flex flex-col after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] has-[[data-cds=CardLink]:focus-visible]:after:shadow-focus min-w-0 ${ROW_RADIUS} after:shadow-none group-focus-visible/tile:after:shadow-focus group-focus-visible/tile:after:outline-hidden flex-1`;

const ROW_FILL_CLASS =
	"cds-card-fill pointer-events-none absolute inset-0 -z-[1] m-0 rounded-[inherit] bg-fill-ghost-hover group-hover/card:bg-neutral-hover";

/** Upstream's ghost icon-only xs cds Button, muted until hovered or focused, always visible on a row. */
const ROW_REMOVE_CLASS =
	"inline-flex shrink-0 cursor-pointer items-center justify-center aspect-square w-control h-control px-0 rounded-[var(--cds-radius--xs)] text-secondary hover:text-primary focus-visible:text-primary hover:bg-fill-ghost-hover outline-none focus-visible:shadow-focus";

/**
 * The row's truncated quote span, which the tooltip sits above (its `display: contents` anchor has no box), as
 * upstream passes the passage ref as the CardLink tooltip's `anchor`: centred on the text, not the whole row.
 */
function quoteSpanOf(anchor: HTMLElement): Element | null
{
	return anchor.closest("[data-cds=Card]")?.querySelector("blockquote > span[dir=auto]") ?? null;
}

/**
 * Upstream's `MessageAttachments.Quote` row variant (`asRow`), as the composer's ChatComposerQuotes column draws
 * a staged reply or plain excerpt: a Reply glyph, the text in curly quotes on one truncated line, an optional
 * hinted badge, and an always-visible remove button.
 */
export function QuoteRow({
	name,
	text,
	badge,
	hint,
	restored,
	style,
	onOpen,
	onLinkKeyDown,
	removeProps,
}: {
	/** The CardLink's sr-only name, also the remove label "Remove {name}". */
	name: string;
	text: string;
	badge?: string | undefined;
	hint?: string | undefined;
	/** Upstream's `data-cds-attachment-restored`: staged before this composer mounted. */
	restored: boolean;
	style: CSSProperties;
	onOpen: (link: HTMLElement) => void;
	/** The CardLink's extra keys: Delete or Backspace removes the row. */
	onLinkKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
	removeProps: ButtonHTMLAttributes<HTMLButtonElement>;
})
{
	const quoteId = useId();
	const badgeId = useId();
	const hintId = useId();
	const badged = badge !== undefined && hint !== undefined;
	const [quoteSpan, setQuoteSpan] = useState<HTMLSpanElement | null>(null);
	const content = useMemo(
		() => (
			<span className="min-w-0 break-words">
				<bdi>{text}</bdi>
			</span>
		),
		[text],
	);
	return (
		<div
			tabIndex={-1}
			data-cds="MessageAttachmentsQuote"
			data-variant="row"
			data-cds-attachment=""
			{...(restored
				?
					{
						"data-cds-attachment-restored": "",
					}
				: {})}
			style={style}
			className="group/tile flex w-full min-w-0 outline-none"
		>
			<div data-cds="Card" className={ROW_CARD_CLASS}>
				<span aria-hidden="true" className={ROW_FILL_CLASS} />
				<div data-cds="CardMedia" className="flex items-center gap-xs p-xs ps-sm">
					<span data-size="xs" className="flex h-control shrink-0 items-center text-ink-muted">
						<Tooltip
							content={content}
							side="top"
							className="contents"
							placeOver={quoteSpanOf}
							openWhen={() => quoteSpan !== null && quoteSpan.scrollWidth > quoteSpan.clientWidth}
						>
							<span
								data-cds="CardLink"
								role="button"
								tabIndex={0}
								aria-describedby={badged ? `${quoteId} ${badgeId} ${hintId}` : quoteId}
								onClick={(event) =>
								{
									event.preventDefault();
									onOpen(event.currentTarget);
								}}
								onKeyDown={(event) =>
								{
									if (event.key === "Enter" || event.key === " ")
									{
										event.preventDefault();
										onOpen(event.currentTarget);
									}
									onLinkKeyDown(event);
								}}
								className="outline-none after:absolute after:inset-0 after:content-[''] cursor-pointer after:rounded-[calc(var(--radius-composer)-4px)]"
							>
								<span className="sr-only">{name}</span>
							</span>
						</Tooltip>
						<Reply aria-hidden="true" className="pointer-events-none size-4 rtl:-scale-x-100" />
					</span>
					<blockquote id={quoteId} className="flex min-w-0 flex-1 text-body font-normal text-secondary">
						<span aria-hidden="true" className="shrink-0 [quotes:auto] before:content-[open-quote]" />
						<span ref={setQuoteSpan} dir="auto" className="min-w-0 truncate">
							{text}
						</span>
						<span aria-hidden="true" className="shrink-0 [quotes:auto] before:content-[close-quote]" />
					</blockquote>
					{badged ? <HintBadge badge={badge} hint={hint} id={badgeId} hintId={hintId} row /> : null}
					<button
						type="button"
						data-size="xs"
						data-cds-attachment-remove=""
						aria-label={`Remove ${name}`}
						{...removeProps}
						className={ROW_REMOVE_CLASS}
					>
						<X aria-hidden="true" className="size-4" />
					</button>
				</div>
			</div>
		</div>
	);
}
