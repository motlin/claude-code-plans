import {useId, useMemo} from "react";

import type {AttachSnippet} from "../lib/attach-markers";
import type {DiffAnnotation} from "../lib/diff-annotation-markers";
import {BADGE_CLASS, CARD_CLASS, CARD_FILL_CLASS} from "./attachment-tile-classes";
import {ExcerptQuote} from "./excerpt-quote";
import {Tooltip} from "./ui/tooltip";

/**
 * Upstream's sent MessageAttachments.Quote tile root: not activatable (no CardLink, no remove button), yet
 * reachable by script focus, and its text stays selectable.
 */
const SENT_TILE_CLASS =
	"group/tile relative isolate size-[7.5rem] shrink-0 rounded-card outline-none focus-visible:shadow-focus self-end select-text";

/** Upstream's cds Card body at its default `p-lg`, which the xs card size scales. */
const SENT_CARD_BODY_CLASS =
	"cds-card-body flex min-h-0 flex-1 flex-col self-stretch [gap:inherit] [align-items:inherit] [justify-content:inherit] rounded-[inherit] p-lg";

/** Upstream `Ig`'s extra classes for a badge that carries a hint: focusable by keyboard, hoverable only by fine pointers. */
const HINT_BADGE_CLASS =
	"pointer-events-auto outline-none focus-visible:shadow-focus pointer-coarse:pointer-events-none";

const NO_ANNOTATIONS: readonly DiffAnnotation[] = [];

const NAME_MAX_CHARS = 60;

/** Upstream `Oi`: an unlabelled excerpt's accessible name, its first non-empty line capped at 60 chars. */
function excerptName(text: string): string {
	const line = (text.split("\n").find((each) => each.trim() !== "") ?? text).trim();
	return line.length > NAME_MAX_CHARS ? `${line.slice(0, NAME_MAX_CHARS - 1)}…` : line;
}

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** Upstream `Ei`: a comment's file name and line or range, marked when it is on the old side. */
function annotationWhere({filePath, startLine, endLine, oldSide}: DiffAnnotation): string {
	const lines = endLine !== undefined && endLine !== startLine ? `${startLine}-${endLine}` : `${startLine}`;
	const where = `${basename(filePath)}:${lines}`;
	return oldSide ? `${where} (before changes)` : where;
}

/** Upstream `Ig`: a badge whose hint shows in a top tooltip on hover or keyboard focus, and describes it. */
function HintBadge({badge, hint}: {badge: string; hint: string}) {
	const hintId = useId();
	const content = useMemo(() => <bdi>{hint}</bdi>, [hint]);
	return (
		<>
			<Tooltip content={content} side="top" className="min-w-0 max-w-full self-start">
				<span
					data-cds="Badge"
					role="img"
					aria-label={badge}
					// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's hinted badge is a Tab stop so the keyboard can open its tooltip
					tabIndex={0}
					aria-describedby={hintId}
					className={`${BADGE_CLASS} ${HINT_BADGE_CLASS}`}
				>
					<span className="pb-[0.05em] min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap">
						<bdi>{badge}</bdi>
					</span>
				</span>
			</Tooltip>
			<span id={hintId} hidden>
				<bdi>{hint}</bdi>
			</span>
		</>
	);
}

/** Upstream's MessageAttachments.Quote as a sent tile: an sr-only name over the quote and its badge. */
function QuoteTile({name, text, badge, hint}: {name: string; text: string; badge: string; hint: string | undefined}) {
	return (
		<div tabIndex={-1} data-cds="MessageAttachmentsQuote" data-cds-attachment="" className={SENT_TILE_CLASS}>
			<div data-cds="Card" data-size="xs" className={CARD_CLASS}>
				<span aria-hidden="true" className={CARD_FILL_CLASS} />
				<div data-cds-card-body="" className={SENT_CARD_BODY_CLASS}>
					<span className="sr-only">{name}</span>
					<ExcerptQuote
						text={text}
						label={badge}
						badge={hint === undefined ? undefined : <HintBadge badge={badge} hint={hint} />}
					/>
				</div>
			</div>
		</div>
	);
}

/**
 * Upstream's sent-message cds MessageAttachments row (`$i`): one Excerpt tile per `<!-- attach -->` snippet,
 * then one "Comment on {where}" tile per diff comment, right-aligned above the bubble.
 */
export function MessageQuoteTiles({
	snippets,
	annotations = NO_ANNOTATIONS,
}: {
	snippets: readonly AttachSnippet[];
	annotations?: readonly DiffAnnotation[];
}) {
	if (snippets.length === 0 && annotations.length === 0) return null;
	return (
		<div
			data-cds="MessageAttachments"
			data-fit="natural"
			data-find-omitted=""
			className="flex w-full flex-wrap justify-end gap-xs items-end empty:hidden"
		>
			{snippets.map((snippet, index) => (
				<QuoteTile
					// oxlint-disable-next-line react/no-array-index-key -- snippets have no identity beyond their order in the prompt
					key={`snippet-${index}`}
					name={snippet.label ?? excerptName(snippet.text)}
					text={snippet.text}
					badge="Excerpt"
					hint={snippet.label}
				/>
			))}
			{annotations.map((annotation, index) => {
				const where = annotationWhere(annotation);
				return (
					<QuoteTile
						// oxlint-disable-next-line react/no-array-index-key -- comments have no identity beyond their order in the prompt
						key={`comment-${index}`}
						name={`Comment on ${where}`}
						text={annotation.body.trim() || annotation.code.trim() || where}
						badge="Comment"
						hint={where}
					/>
				);
			})}
		</div>
	);
}

/** The excerpt-only row, for callers that carry no diff comments. */
export const MessageExcerptTiles = MessageQuoteTiles;
