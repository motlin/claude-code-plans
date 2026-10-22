import {revealFileInFinder} from "../../lib/api/file";
import {writeClipboardText} from "../../lib/clipboard";
import type {AttachContextHandler} from "../../lib/context-attach";
import {vscodeFolderUrl} from "../../lib/session-open-in";
import {useToast} from "../toast-context";
import {MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger} from "../ui/menu";
import {mentionPath, relativeToCwd} from "./mention-path";

/*
 * claude.ai/code's shared file-actions block (`Un` in c856385e2), desktop
 * `local` variant: Attach as context · Copy ▸ · ─ · Open in ▸ · Show in Finder.
 */

/** Upstream `FD` (shared-28): binary, office, archive and media files no editor should open. */
const NON_EDITOR_EXTENSION =
	/\.(doc[xm]?|xls[xm]?|ppt[xm]?|od[tsp]|rtf|epub|mobi|pages|numbers|zip|t?gz|tar|bz2|xz|zst|7z|rar|jar|war|dmg|iso|deb|rpm|apk|msi|pkg|img|wasm|exe|dll|so(?:\.\d+)*|dylib|bin|class|pyc|o|a|db|sqlite3?|parquet|woff2?|ttf|otf|eot|pdf|mp4|webm|m4v|mov|ogv|avi|mkv|wmv|flv|mpe?g|m2ts|3gp|mp3|m4a|aac|flac|wav|ogg|oga|opus|aiff?|wma|midi?|ico|tiff?|heic|heif|jfif|psd|tga|dng|svgz)$/i;

/** Upstream `$3` (shared-m-0): the image extensions `mw` excludes. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "avif"]);

/** Upstream `fT` (shared-28): files the Files pane can preview. */
const FILES_PANE_EXTENSION = /\.(html?|svg|pdf|mp4|webm|m4v|mov|ogv)$/i;

function extension(path: string): string {
	const dot = path.lastIndexOf(".");
	return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

/** Upstream `p3`: a file an editor can open (not binary/office/archive/media, not an image). */
export function isEditableText(path: string): boolean {
	return !NON_EDITOR_EXTENSION.test(path) && !IMAGE_EXTENSIONS.has(extension(path));
}

/** `vscode://file/<abs>`, plus `:<line>` to open the file at that line. */
export function vscodeFileUrl(path: string, line?: number): string {
	const url = vscodeFolderUrl(path);
	return line === undefined ? url : `${url}:${line}`;
}

function baseName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** Upstream `we`: one success toast for every Copy row. */
function useCopyToClipboard(): (text: string) => void {
	const toast = useToast();
	return (text) => {
		void writeClipboardText(text).then((copied) => {
			toast(
				copied
					? {kind: "success", message: "Copied to clipboard."}
					: {kind: "error", message: "Couldn’t copy to clipboard."},
			);
		});
	};
}

type FileActionsSurface = "transcript" | "composer" | "attachment" | "file_browser";

interface FileActionsMenuItemsProps {
	/** Absolute path of the file or folder. */
	path: string;
	cwd: string | undefined;
	isDirectory?: boolean;
	/** The line VS Code opens at. */
	line?: number;
	surface: FileActionsSurface;
	/** False hides Attach as context, as upstream's composer chips do. */
	attach?: boolean;
	/** Lead with a separator, for rows rendered above the block. */
	separatorBefore?: boolean;
	/** The file is gone: hide Open in ▸ and Show in Finder. */
	gone?: boolean;
	onAttachContext?: AttachContextHandler | undefined;
	/** Offers Open in ▸ Files pane (transcript html/svg/pdf/video). */
	onOpenInFilesPane?: (() => void) | undefined;
	/** Offers Open in ▸ Default app (transcript files inside the cwd). */
	onOpenInDefaultApp?: (() => void) | undefined;
}

export function FileActionsMenuItems({
	path,
	cwd,
	isDirectory = false,
	line,
	surface,
	attach = true,
	separatorBefore = false,
	gone = false,
	onAttachContext,
	onOpenInFilesPane,
	onOpenInDefaultApp,
}: FileActionsMenuItemsProps) {
	const copy = useCopyToClipboard();
	const toast = useToast();
	const relPath = relativeToCwd(path, cwd);
	const showEditor = isDirectory || isEditableText(path);
	const showFilesPane =
		onOpenInFilesPane !== undefined && surface === "transcript" && FILES_PANE_EXTENSION.test(path);
	const showDefaultApp =
		onOpenInDefaultApp !== undefined && surface === "transcript" && !isDirectory && relPath !== null;
	const showOpenIn = showEditor || showFilesPane || showDefaultApp;
	return (
		<>
			{separatorBefore && <MenuSeparator />}
			{attach && onAttachContext !== undefined && (
				<MenuItem
					onSelect={() => {
						onAttachContext({kind: "file", path: `${mentionPath(path, cwd)}${isDirectory ? "/" : ""}`});
					}}
				>
					Attach as context
				</MenuItem>
			)}
			<MenuSub>
				<MenuSubTrigger>Copy</MenuSubTrigger>
				{/* Upstream's Xu passes sideOffset -4: the popup's edge sits on the Copy row's edge. */}
				<MenuSubContent sideOffset={-4}>
					<MenuItem
						onSelect={() => {
							copy(path);
						}}
					>
						Absolute path
					</MenuItem>
					{relPath !== null && (
						<MenuItem
							onSelect={() => {
								copy(relPath);
							}}
						>
							Relative path
						</MenuItem>
					)}
					<MenuItem
						onSelect={() => {
							copy(baseName(path));
						}}
					>
						Filename
					</MenuItem>
				</MenuSubContent>
			</MenuSub>
			{!gone && (
				<>
					<MenuSeparator />
					{showOpenIn && (
						<MenuSub>
							<MenuSubTrigger>Open in</MenuSubTrigger>
							<MenuSubContent>
								{showEditor && (
									<MenuItem onSelect={() => window.open(vscodeFileUrl(path, line), "_self")}>
										VS Code
									</MenuItem>
								)}
								{showEditor && (showFilesPane || showDefaultApp) && <MenuSeparator />}
								{showFilesPane && <MenuItem onSelect={onOpenInFilesPane}>Files pane</MenuItem>}
								{showDefaultApp && <MenuItem onSelect={onOpenInDefaultApp}>Default app</MenuItem>}
							</MenuSubContent>
						</MenuSub>
					)}
					<MenuItem
						onSelect={() => {
							revealFileInFinder(path).catch(() => {
								toast({
									kind: "error",
									message: "Couldn’t show this in Finder. It may have been deleted or moved.",
								});
							});
						}}
					>
						Show in Finder
					</MenuItem>
				</>
			)}
		</>
	);
}
