import type {ReactNode} from "react";

import type {AcceptedMention} from "../lib/composer-mentions";

/**
 * Upstream's mention node-view wrapper (`Um`), minus `inline-flex` and `mx-0.5`: the chip stays
 * inline so its glyphs line up with the transparent textarea text under it (documented deviation).
 * It's the only part of the pointer-transparent overlay that takes the mouse, so hover works.
 */
const CHIP_CLASS = "group/mention relative cursor-interactive pointer-events-auto text-upstream-accent";

const HIGHLIGHT_CLASS =
	"pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5 [@media(hover:hover)]:group-hover/mention:bg-fill-ghost-hover";

/**
 * An accepted `@` file mention, painted in the composer's mirror overlay over its `@relPath`
 * textarea text. Upstream's chip shows the basename and a file-type icon; a textarea can only
 * restyle the characters it holds, so this one shows `@relPath` in accent.
 */
function ComposerMentionChip({
	relPath,
	isDirectory,
	children,
}: {
	relPath: string;
	isDirectory: boolean;
	children: ReactNode;
}) {
	return (
		<span
			data-testid="composer-mention-chip"
			data-path={relPath}
			data-directory={isDirectory ? "" : undefined}
			dir="auto"
			className={CHIP_CLASS}
		>
			<span aria-hidden="true" className={HIGHLIGHT_CLASS} />
			{/* Upstream's renderedText keeps a directory's trailing slash. */}
			<span title={isDirectory ? `${relPath}/` : relPath} className="relative">
				{children}
			</span>
		</span>
	);
}

/** `text` (found at `offset` in the prompt) with every mention it fully holds wrapped in a chip. */
export function paintMentions(text: string, offset: number, mentions: readonly AcceptedMention[]): ReactNode[] {
	const end = offset + text.length;
	const inside = mentions
		.filter((mention) => mention.start >= offset && mention.end <= end)
		.toSorted((a, b) => a.start - b.start);
	const nodes: ReactNode[] = [];
	let cursor = offset;
	for (const mention of inside) {
		if (mention.start > cursor) nodes.push(text.slice(cursor - offset, mention.start - offset));
		nodes.push(
			<ComposerMentionChip key={mention.start} relPath={mention.relPath} isDirectory={mention.isDirectory}>
				{text.slice(mention.start - offset, mention.end - offset)}
			</ComposerMentionChip>,
		);
		cursor = mention.end;
	}
	if (cursor < end) nodes.push(text.slice(cursor - offset));
	return nodes;
}
