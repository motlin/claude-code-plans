import {useQuery, useQueryClient} from "@tanstack/react-query";

import {fileContentUrl, fileViewQueryOptions, revealFileInFinder} from "../../lib/api/file";
import {writeClipboardText} from "../../lib/clipboard";
import type {AttachContextHandler, ContextAttachment} from "../../lib/context-attach";
import type {FileTabsAction} from "../../lib/file-tabs";
import {requestFindInFile} from "../../lib/find-in-file-request";
import {vscodeFolderUrl} from "../../lib/session-open-in";
import {useToast} from "../toast";
import {MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger} from "../ui/menu";

/*
 * The Files pane's right-click menus, copied from claude.ai/code: tree rows,
 * open-file tabs and the viewer share "Attach as context" and Copy ▸, and each
 * surface adds its own actions below them.
 */

/** A file's path relative to the working directory, or null outside it. */
function relativeToCwd(path: string, cwd: string | undefined): string | null {
	if (cwd === undefined) return null;
	const prefix = `${cwd.replace(/\/+$/, "")}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** The path an `@` mention uses: relative inside the working directory, absolute outside. */
export function mentionPath(path: string, cwd: string | undefined): string {
	return relativeToCwd(path, cwd) ?? path;
}

/** `vscode://file/<abs>:<line>`, which opens the file at that line in VS Code. */
function vscodeFileUrl(path: string, line: number): string {
	return `${vscodeFolderUrl(path)}:${line}`;
}

function baseName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

function useCopyText(): (text: string, what: string) => void {
	const toast = useToast();
	return (text, what) => {
		void writeClipboardText(text).then((copied) =>
			toast(
				copied
					? {kind: "success", message: `${what} copied to clipboard.`}
					: {kind: "error", message: `Couldn’t copy the ${what.toLowerCase()}.`},
			),
		);
	};
}

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
	const copy = useCopyText();
	const relPath = relativeToCwd(path, cwd);
	return (
		<>
			{onAttachContext !== undefined && (
				<MenuItem
					onSelect={() => onAttachContext(attachment())}
					{...(attachShortcut === undefined ? {} : {shortcut: attachShortcut})}
				>
					Attach as context
				</MenuItem>
			)}
			<MenuSub>
				<MenuSubTrigger>Copy</MenuSubTrigger>
				<MenuSubContent>
					{absolutePath && <MenuItem onSelect={() => copy(path, "Path")}>Absolute path</MenuItem>}
					<MenuItem
						disabled={relPath === null}
						onSelect={() => {
							if (relPath !== null) copy(relPath, "Path");
						}}
					>
						Relative path
					</MenuItem>
					<MenuItem onSelect={() => copy(baseName(path), "Filename")}>Filename</MenuItem>
				</MenuSubContent>
			</MenuSub>
		</>
	);
}

interface TreeRowMenuItemsProps {
	path: string;
	cwd: string;
	isDirectory: boolean;
	onAttachContext: AttachContextHandler | undefined;
}

export function TreeRowMenuItems({path, cwd, isDirectory, onAttachContext}: TreeRowMenuItemsProps) {
	const mention = mentionPath(path, cwd);
	return (
		<SharedItems
			path={path}
			cwd={cwd}
			attachment={() => ({kind: "file", path: `${mention}${isDirectory ? "/" : ""}`})}
			onAttachContext={onAttachContext}
		/>
	);
}

function CopyContentsItem({content}: {content: string | undefined}) {
	const copy = useCopyText();
	return (
		<MenuItem
			disabled={content === undefined}
			onSelect={() => {
				if (content !== undefined) copy(content, "File contents");
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
			{preview && <MenuItem onSelect={() => dispatch({type: "pin", path})}>Keep open</MenuItem>}
			<MenuItem onSelect={() => dispatch({type: "close", path})}>Close file</MenuItem>
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
	const toast = useToast();
	const revealInFinder = () => {
		revealFileInFinder(path).catch(() => toast({kind: "error", message: "Couldn’t reveal the file in Finder."}));
	};
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
			<MenuSub>
				<MenuSubTrigger>Open in</MenuSubTrigger>
				<MenuSubContent>
					<MenuItem onSelect={() => window.open(vscodeFileUrl(path, line), "_self")}>VS Code</MenuItem>
					<MenuItem onSelect={revealInFinder}>Finder</MenuItem>
				</MenuSubContent>
			</MenuSub>
		</>
	);
}
