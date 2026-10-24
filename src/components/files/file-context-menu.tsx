import {useQuery, useQueryClient} from "@tanstack/react-query";

import {fileContentUrl, fileViewQueryOptions} from "../../lib/api/file";
import type {AttachContextHandler, ContextAttachment} from "../../lib/context-attach";
import type {FileTabsAction} from "../../lib/file-tabs";
import {requestFindInFile} from "../../lib/find-in-file-request";
import {
	CopySubmenu,
	FileActionsMenuItems,
	OpenInSubmenu,
	ShowInFinderItem,
	useCopyToClipboard,
} from "./file-actions-menu";
import {MenuItem, MenuSeparator} from "../ui/menu";
import {mentionPath, relativeToCwd} from "./mention-path";

/*
 * The Files pane's right-click menus, copied from claude.ai/code: tree rows,
 * open-file tabs and the viewer share "Attach as context" and Copy ▸, and each
 * surface adds its own actions below them.
 */

interface SharedItemsProps {
	/** Absolute path of the file or folder. */
	path: string;
	cwd: string | undefined;
	/** What "Attach as context" attaches; the item is hidden without `onAttachContext`. */
	attachment: () => ContextAttachment;
	onAttachContext: AttachContextHandler | undefined;
	/** Show ⇧⌘L beside "Attach as context", where the shortcut applies. */
	attachShortcut?: string | undefined;
	/** Offer Absolute path under Copy ▸; file tabs, like claude.ai/code, don't. */
	absolutePath?: boolean;
}

/** Attach as context · Copy ▸ {Absolute path?, Relative path, Filename}. */
function SharedItems({path, cwd, attachment, onAttachContext, attachShortcut, absolutePath = true}: SharedItemsProps) {
	return (
		<>
			{onAttachContext !== undefined && (
				<MenuItem
					onSelect={() => {
						onAttachContext(attachment());
					}}
					{...(attachShortcut === undefined ? {} : {shortcut: attachShortcut})}
				>
					Attach as context
				</MenuItem>
			)}
			<CopySubmenu path={path} cwd={cwd} absolutePath={absolutePath} />
		</>
	);
}

interface TreeRowMenuItemsProps {
	path: string;
	cwd: string;
	isDirectory: boolean;
	onAttachContext: AttachContextHandler | undefined;
}

/** Upstream `En`'s desktop rows: Attach as context · Copy ▸ · ─ · Open in ▸ · Show in Finder. */
export function TreeRowMenuItems({path, cwd, isDirectory, onAttachContext}: TreeRowMenuItemsProps) {
	return (
		<FileActionsMenuItems
			path={path}
			cwd={cwd}
			isDirectory={isDirectory}
			surface="file_browser"
			onAttachContext={onAttachContext}
		/>
	);
}

function CopyContentsItem({content}: {content: string | undefined}) {
	const copy = useCopyToClipboard();
	return (
		<MenuItem
			disabled={content === undefined}
			onSelect={() => {
				if (content !== undefined) copy(content);
			}}
		>
			Copy file contents
		</MenuItem>
	);
}

function DownloadItem({path}: {path: string}) {
	return <MenuItem render={<a href={fileContentUrl(path, {download: true})} download />}>Download file</MenuItem>;
}

interface TabMenuItemsProps {
	path: string;
	/** A preview (italic) tab offers Keep open. */
	preview: boolean;
	cwd: string | undefined;
	onAttachContext: AttachContextHandler | undefined;
	onRevealInTree: ((path: string) => void) | undefined;
	dispatch: (action: FileTabsAction) => void;
}

/**
 * claude.ai/code's file tab menu. Find, Copy file contents, Download and
 * Reload appear only once the file's content has loaded.
 */
export function TabMenuItems({path, preview, cwd, onAttachContext, onRevealInTree, dispatch}: TabMenuItemsProps) {
	const queryClient = useQueryClient();
	const file = useQuery({...fileViewQueryOptions(path), enabled: false});
	const data = file.data;
	return (
		<>
			<SharedItems
				path={path}
				cwd={cwd}
				attachment={() => ({kind: "file", path: mentionPath(path, cwd)})}
				onAttachContext={onAttachContext}
				absolutePath={false}
			/>
			<MenuSeparator />
			<MenuItem
				disabled={onRevealInTree === undefined || relativeToCwd(path, cwd) === null}
				onSelect={() => onRevealInTree?.(path)}
			>
				Reveal in file tree
			</MenuItem>
			<MenuSeparator />
			{data !== undefined && (
				<>
					<MenuItem
						onSelect={() => {
							dispatch({type: "reveal", path});
							requestFindInFile(path);
						}}
					>
						Find in file
					</MenuItem>
					<CopyContentsItem content={data.kind === "text" ? data.content : undefined} />
					<DownloadItem path={path} />
					<MenuItem onSelect={() => void queryClient.invalidateQueries({queryKey: ["file", path]})}>
						Reload file
					</MenuItem>
					<MenuSeparator />
				</>
			)}
			{preview && (
				<MenuItem
					onSelect={() => {
						dispatch({type: "pin", path});
					}}
				>
					Keep open
				</MenuItem>
			)}
			<MenuItem
				onSelect={() => {
					dispatch({type: "close", path});
				}}
			>
				Close file
			</MenuItem>
		</>
	);
}

interface ViewerMenuItemsProps {
	path: string;
	cwd: string | undefined;
	/** The loaded text, when the viewer shows the file as text. */
	content: string | undefined;
	/** The line VS Code opens at. */
	line: number;
	attachment: () => ContextAttachment;
	onAttachContext: AttachContextHandler | undefined;
	attachShortcut: string;
}

export function ViewerMenuItems({
	path,
	cwd,
	content,
	line,
	attachment,
	onAttachContext,
	attachShortcut,
}: ViewerMenuItemsProps) {
	return (
		<>
			<SharedItems
				path={path}
				cwd={cwd}
				attachment={attachment}
				onAttachContext={onAttachContext}
				attachShortcut={attachShortcut}
			/>
			<CopyContentsItem content={content} />
			<DownloadItem path={path} />
			<MenuSeparator />
			<OpenInSubmenu path={path} line={line} />
			<ShowInFinderItem path={path} />
		</>
	);
}
