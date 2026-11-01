import type {ReactNode, RefObject} from "react";

import type {AcceptedMention} from "../lib/composer-mentions";
import {ComposerMentionChip} from "./composer-mention-chip";

/** What a chip does with the pointer: a left press selects it, its menu's Delete removes it. */
export interface MentionChipActions {
	onPress: (mention: AcceptedMention) => void;
	onDelete: (mention: AcceptedMention) => void;
	/** Where focus returns when the chip's menu closes. */
	editorRef: RefObject<HTMLTextAreaElement | null>;
	/** The session's working directory; without it the menu holds only Delete. */
	cwd: string | undefined;
}

/**
 * `text` (found at `offset` in the prompt) with every mention it fully holds wrapped in a chip,
 * `selected` painted as the selected one.
 */
export function paintMentions(
	text: string,
	offset: number,
	mentions: readonly AcceptedMention[],
	selected: AcceptedMention | undefined,
	actions: MentionChipActions,
): ReactNode[] {
	const end = offset + text.length;
	const inside = mentions
		.filter((mention) => mention.start >= offset && mention.end <= end)
		.toSorted((a, b) => a.start - b.start);
	const nodes: ReactNode[] = [];
	let cursor = offset;
	for (const mention of inside) {
		if (mention.start > cursor) nodes.push(text.slice(cursor - offset, mention.start - offset));
		nodes.push(
			<ComposerMentionChip
				key={mention.start}
				relPath={mention.relPath}
				isDirectory={mention.isDirectory}
				selected={mention === selected}
				onPress={() => {
					actions.onPress(mention);
				}}
				onDelete={() => {
					actions.onDelete(mention);
				}}
				editorRef={actions.editorRef}
				cwd={actions.cwd}
			>
				{text.slice(mention.start - offset, mention.end - offset)}
			</ComposerMentionChip>,
		);
		cursor = mention.end;
	}
	if (cursor < end) nodes.push(text.slice(cursor - offset));
	return nodes;
}
