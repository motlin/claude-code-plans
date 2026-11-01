import type {MouseEvent, ReactNode, RefObject} from "react";

import {FileActionsMenuItems} from "./files/file-actions-menu";
import {absoluteMentionPath} from "./files/mention-path";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem, MenuSeparator} from "./ui/menu";

/**
 * Upstream's mention node-view wrapper (`Um`), minus `inline-flex` and `mx-0.5`: the chip stays
 * inline so its glyphs line up with the transparent textarea text under it (documented deviation).
 * It's the only part of the pointer-transparent overlay that takes the mouse, so hover works.
 */
const CHIP_CLASS =
	"group/mention relative cursor-interactive pointer-events-auto text-upstream-accent [overflow-wrap:anywhere]";

const HIGHLIGHT_BASE_CLASS = "pointer-events-none absolute -inset-y-0.5 -left-0.5 -right-1 rounded-r5";
const HIGHLIGHT_CLASS = `${HIGHLIGHT_BASE_CLASS} [@media(hover:hover)]:group-hover/mention:bg-fill-ghost-hover`;
/** Upstream swaps the hover fill for `bg-accent` while the atom is the NodeSelection. */
const HIGHLIGHT_SELECTED_CLASS = `${HIGHLIGHT_BASE_CLASS} bg-upstream-accent-pressed`;

/**
 * An accepted `@` file mention, painted in the composer's mirror overlay over its `@relPath`
 * textarea text. Upstream's chip shows the basename and a file-type icon; a textarea can only
 * restyle the characters it holds, so this one shows `@relPath` in accent.
 */
export function ComposerMentionChip({
	relPath,
	isDirectory,
	selected,
	onPress,
	onDelete,
	editorRef,
	cwd,
	children,
}: {
	relPath: string;
	isDirectory: boolean;
	selected: boolean;
	onPress: () => void;
	onDelete: () => void;
	editorRef: RefObject<HTMLTextAreaElement | null>;
	cwd: string | undefined;
	children: ReactNode;
}) {
	const path = absoluteMentionPath(relPath, cwd);
	return (
		// Upstream `GZ`: the file-actions block (`Sl`, attach off) over a danger Delete; Delete alone without a path context.
		<ContextMenu>
			<ContextMenuTrigger
				render={<span />}
				data-testid="composer-mention-chip"
				data-path={relPath}
				data-directory={isDirectory ? "" : undefined}
				dir="auto"
				className={CHIP_CLASS}
				// Upstream `lI`: the editor's and transcript's own menus don't also open.
				onContextMenu={(e: MouseEvent) => {
					e.stopPropagation();
				}}
				onMouseDown={(e: MouseEvent) => {
					// Upstream `yl`: only non-left presses stop here; a left press selects the atom.
					if (e.button !== 0) {
						e.stopPropagation();
						return;
					}
					e.preventDefault();
					onPress();
				}}
			>
				<span aria-hidden="true" className={selected ? HIGHLIGHT_SELECTED_CLASS : HIGHLIGHT_CLASS} />
				{/* Upstream's renderedText keeps a directory's trailing slash. */}
				<span title={isDirectory ? `${relPath}/` : relPath} className="relative [&::selection]:bg-transparent">
					{children}
				</span>
			</ContextMenuTrigger>
			<MenuContent density="compact" finalFocus={editorRef}>
				{path !== null && (
					<>
						<FileActionsMenuItems
							path={path}
							cwd={cwd}
							isDirectory={isDirectory}
							surface="composer"
							attach={false}
						/>
						<MenuSeparator />
					</>
				)}
				<MenuItem variant="danger" onSelect={onDelete}>
					Delete
				</MenuItem>
			</MenuContent>
		</ContextMenu>
	);
}
