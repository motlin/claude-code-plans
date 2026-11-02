import type {ReactNode} from "react";
import {CopySubmenu} from "../files/file-actions-menu";
import {MenuGroup, MenuItem, MenuSeparator} from "../ui/menu";
import type {DiffFileMark} from "./diff-file-menu-gate";

/*
 * claude.ai/code's Changes file menu: c44d00c7f `ac`/`oc` (was `Fo`/`Io`). The file header's
 * right-click menu, its "…" More actions dropdown and the Changes tree row menu all render it.
 */

/** How much of the file the diff shows: `unread` = the loader failed, `locked` = a finding or comment pins it open. */
export type WholeFileState = "folded" | "unread" | "shown" | "locked";

export interface DiffFileMenuItemsProps
{
	/** The diff path: repo-root-relative for git, cwd-relative or absolute for session edits. */
	path: string;
	/** Offers Copy ▸ Absolute path. */
	absolutePath?: string | undefined;
	onAttachFile?: (() => void) | undefined;
	/** Undefined when the file can't be opened. */
	onOpenFile?: (() => void) | undefined;
	openFileShortcut?: string | undefined;
	isDirectory?: boolean | undefined;
	wholeFile?: WholeFileState | undefined;
	onShowWholeFile?: ((path: string, show: boolean) => void) | undefined;
	mark?: DiffFileMark | undefined;
	/** Upstream `renderFileMenuItems`: Open in ▸ and Show in Finder, behind a separator when there's no Open file row. */
	renderFileMenuItems?: ((options: {separatorBefore: boolean; isDirectory: boolean}) => ReactNode) | undefined;
}

function baseName(path: string): string
{
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

function wholeFileReason(state: WholeFileState, canOpen: boolean): string | undefined
{
	if (state === "unread")
	{
		return `This file’s unmodified lines couldn’t be read.${canOpen ? " Open the file to see all of it." : ""}`;
	}
	if (state === "locked")
	{
		return "This file has a review finding, or a comment on an unmodified line. Dismiss the finding or delete the comment to show changes only.";
	}
	return undefined;
}

export function DiffFileMenuItems({
	path,
	absolutePath,
	onAttachFile,
	onOpenFile,
	openFileShortcut,
	isDirectory = false,
	wholeFile,
	onShowWholeFile,
	mark,
	renderFileMenuItems,
}: DiffFileMenuItemsProps)
{
	const showWholeFile = wholeFile !== undefined && onShowWholeFile !== undefined;
	const folded = wholeFile === "folded" || wholeFile === "unread";
	return (
		<>
			{onAttachFile !== undefined && <MenuItem onSelect={onAttachFile}>Attach as context</MenuItem>}
			<CopySubmenu
				path={absolutePath ?? baseName(path)}
				cwd={undefined}
				absolutePath={absolutePath !== undefined}
				relativePath={path}
			/>
			{(showWholeFile || mark !== undefined) && (
				<>
					<MenuSeparator />
					<MenuGroup>
						{showWholeFile && (
							<MenuItem
								disabled={wholeFile === "unread" || wholeFile === "locked"}
								disabledReason={wholeFileReason(wholeFile, onOpenFile !== undefined)}
								onSelect={() =>
								{
									onShowWholeFile(path, folded);
								}}
							>
								{folded ? "Show whole file" : "Show changes only"}
							</MenuItem>
						)}
						{mark !== undefined && (
							<MenuItem
								disabled={!mark.canMark}
								disabledReason="This file can’t be marked as viewed. Later changes to it wouldn’t be detected."
								onSelect={() =>
								{
									mark.setMarked(mark.status !== "marked");
								}}
							>
								{mark.status === "marked" ? "Mark as not viewed" : "Mark as viewed"}
							</MenuItem>
						)}
					</MenuGroup>
				</>
			)}
			{onOpenFile !== undefined && (
				<>
					<MenuSeparator />
					<MenuItem
						onSelect={onOpenFile}
						{...(openFileShortcut === undefined
							? {}
							:
								{
									shortcut: openFileShortcut,
								})}
					>
						Open file
					</MenuItem>
				</>
			)}
			{renderFileMenuItems?.(
				{
					separatorBefore: onOpenFile === undefined,
					isDirectory,
				},
			)}
		</>
	);
}
