import {useQuery} from "@tanstack/react-query";
import {Code, Eye, FileX} from "lucide-react";
import
{
	type CSSProperties,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	type RefObject,
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import {useShortcut, useShortcutKeys} from "../../hooks/use-shortcut";
import {useHighlightedLines} from "../../hooks/use-shiki";

import {ApiResponseError} from "../../lib/api/client";
import {fileContentUrl, fileViewQueryOptions} from "../../lib/api/file";
import type {AttachContextHandler, ContextAttachment} from "../../lib/context-attach";
import {formatFileSize, imageContentType, isMarkdownPath, normalizeFileTabSize} from "../../lib/file-preview";
import {firstMatchFromLine, lineMatchOffsets, stepMatch} from "../../lib/find-in-file";
import {editableMarkdownTarget} from "../../lib/file-edit";
import {registerFindInFile} from "../../lib/find-in-file-request";
import {fileRefTexts} from "../../lib/client-markdown";
import {fromMdSlug} from "../../lib/md-slug";
import {isMacPlatform} from "../../lib/shortcuts/match";
import {useResolvedFileRefs} from "../use-resolved-file-refs";
import {FileTypeIcon} from "../file-type-icon";
import {FileViewer} from "../file-viewer";
import {fileViewerLanguage} from "../file-viewer-utils";
import {DocumentDiagrams} from "../diagram-lightbox";
import {MarkdownArticle} from "../markdown-article";
import {useSettings} from "../settings-context";
import {ContextMenu, ContextMenuTrigger, MenuContent} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";
import {useCopyToClipboard} from "./use-copy-to-clipboard";
import {type SourceEditorMenuActions, ViewerMenuItems} from "./file-context-menu";
import {mentionPath} from "./mention-path";
import {FindBar} from "./find-in-file";
import {clearFindHighlights, collectFindBlocks, paintFindHighlights} from "./find-highlights";
import {useMarkdownEdit} from "./markdown-edit";
import {SaveErrorBanner} from "./save-error-banner";
import {GoToLineBar} from "./go-to-line-bar";
import {LazySourceEditor} from "./lazy-source-editor";
import type {FindHighlight, SourceEditorHandle} from "./source-editor";
import {useSourceFileSave} from "./use-source-file-save";
import {cdsButtonClass} from "../ui/cds-button";
import {SUPPRESS_NATIVE_MENU_POPUP_PROPS} from "../../lib/native-context-menu";

/**
 * Sibling `.md` links render under this prefix; a click handler resolves them
 * against the file's own directory, since file routes are keyed by an opaque
 * path token rather than a directory and slug.
 */
const SIBLING_MD_BASE = "/__file-sibling";
const VIEWER_HOST_CLASS = "h-full overflow-hidden text-code [&_.cm-editor]:h-full";
const VIEWER_HOST_STYLE: CSSProperties =
{
	contain: "size layout",
};

export interface FileViewProps
{
	/** Absolute path of the file. */
	path: string;
	/** Working directory; paths inside it show and copy relative to it. */
	cwd?: string | undefined;
	line?: number | undefined;
	endLine?: number | undefined;
	/** The content search query that opened the file, handed to find in file. */
	findQuery?: string | undefined;
	/** Follow `#L<n>` in the page URL; only the full-page `/file/$` route owns the hash. */
	hashNavigation?: boolean;
	/** Opens another file, such as a sibling `.md` link in rendered markdown. */
	onOpenFile?: ((path: string) => void) | undefined;
	/** Sends an "Attach as context" snippet to the chat input; without it the viewer offers none. */
	onAttachContext?: AttachContextHandler | undefined;
	/** Starting an edit of a plan or memory; the Files pane pins the tab. */
	onEditStart?: (() => void) | undefined;
	/** Whether the file has unsaved edits, for the pane's leave-tab guard. */
	onDirtyChange?: ((dirty: boolean) => void) | undefined;
}

function displayPath(path: string, cwd: string | undefined): string
{
	if (cwd === undefined) return path;
	const prefix = `${cwd.replace(/\/+$/, "")}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function directoryOf(path: string): string
{
	return path.slice(0, path.lastIndexOf("/"));
}

/** The subheader's `dir / dir / name` breadcrumb, which copies the path when clicked. */
function Breadcrumb({path}: {path: string})
{
	const copy = useCopyToClipboard();
	const segments = path.split("/");
	return (
		<button
			type="button"
			aria-label={`Copy path ${path}`}
			onClick={() =>
			{
				copy(path);
			}}
			className="-mx-0.75 flex min-w-0 flex-1 cursor-pointer rounded-r3 text-left text-pane text-secondary hover:bg-fill-ghost-hover"
		>
			<span className="-mx-1 -my-1 flex min-w-0 overflow-x-auto px-1 py-1 whitespace-nowrap [direction:rtl] [scrollbar-width:none]">
				<span dir="ltr" className="flex min-w-full shrink-0 items-baseline">
					{segments.map((segment, index) =>
					{
						const isName = index === segments.length - 1;
						return (
							<span key={index} className="flex shrink-0 items-baseline">
								{segment !== "" && (
									<span
										data-breadcrumb-segment=""
										title={segments.slice(0, index + 1).join("/")}
										className={`shrink-0 px-0.75 ${isName ? "" : "text-ink-muted"}`}
									>
										{segment}
									</span>
								)}
								{!isName && <span className="shrink-0 text-ink-muted">/</span>}
							</span>
						);
					})}
				</span>
			</span>
		</button>
	);
}

const NO_SESSION_PATHS: readonly string[] = [];

/**
 * Rendered markdown whose inline-code paths that name existing files become
 * buttons opening them, resolved against the file's directory, then the cwd.
 */
function LinkedMarkdown({
	markdown,
	path,
	cwd,
	onOpenFile,
}: {
	markdown: string;
	path: string;
	cwd: string | undefined;
	onOpenFile: (path: string) => void;
})
{
	const texts = useMemo(() => fileRefTexts(markdown), [markdown]);
	const refs = useResolvedFileRefs(texts, NO_SESSION_PATHS, [directoryOf(path), cwd]);
	return (
		<MarkdownArticle
			markdown={markdown}
			diagrams
			mdLinkBase={SIBLING_MD_BASE}
			fileRefs={refs.size === 0 ? undefined : refs}
			onFileRef={(ref) =>
			{
				onOpenFile(ref.path);
			}}
		/>
	);
}

function ViewerMessage({
	title,
	detail,
	fileName,
	children,
}: {
	title: string;
	detail?: string;
	fileName?: string;
	children?: ReactNode;
})
{
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-4 text-center">
			{fileName === undefined ? (
				<FileX aria-hidden="true" className="size-7 text-t6" />
			) : (
				<FileTypeIcon
					fileName={fileName}
					size="xl"
					className="text-ink-muted"
					fallback={<FileX aria-hidden="true" className="size-7 text-ink-muted" />}
				/>
			)}
			<div className="flex flex-col items-center gap-1">
				<p className="max-w-[36ch] text-pretty break-words text-body text-primary">{title}</p>
				{detail !== undefined && (
					<p className="max-w-[36ch] text-pretty break-all text-footnote text-t6">{detail}</p>
				)}
			</div>
			{children !== undefined && (
				<div className="flex flex-wrap items-center justify-center gap-1">{children}</div>
			)}
		</div>
	);
}

const MESSAGE_BUTTON =
	"inline-flex h-7 cursor-pointer items-center rounded-r5 border border-strong px-2.5 text-footnote text-primary hover:bg-fill-ghost-hover";

function ImageView({path}: {path: string})
{
	const [failed, setFailed] = useState(false);
	if (failed)
	{
		return (
			<ViewerMessage
				title="This image couldn’t be loaded. It may be too large, or it may have been deleted or moved."
				fileName={path}
			/>
		);
	}
	return (
		<div className="flex h-full items-center justify-center overflow-auto p-3">
			<img
				alt={path.slice(path.lastIndexOf("/") + 1)}
				src={fileContentUrl(path)}
				onError={() =>
				{
					setFailed(true);
				}}
				className="max-h-full max-w-full object-contain"
			/>
		</div>
	);
}

function lineNumberOf(node: Node): number | null
{
	const element = node instanceof Element ? node : node.parentElement;
	const row = element?.closest<HTMLElement>('[role="row"][id^="L"]');
	if (row === null || row === undefined) return null;
	const line = Number(row.id.slice(1));
	return Number.isSafeInteger(line) && line > 0 ? line : null;
}

/**
 * The attachment for the page selection when it lies inside `container`:
 * whole source lines with their `#L` range, or the selected text of rendered
 * markdown. Null without such a selection.
 */
function selectionAttachment(
	container: HTMLElement | null,
	path: string,
	cwd: string | undefined,
	content: string | undefined,
	editor: SourceEditorHandle | null,
): ContextAttachment | null
{
	const lines = editor?.hasFocus() === true ? editor.selectedLines() : null;
	if (lines !== null)
	{
		return {
			kind: "selection",
			path: mentionPath(path, cwd),
			range:
			{
				start: lines.start,
				end: lines.end,
			},
			text: lines.text,
			language: fileViewerLanguage(path),
		};
	}
	const selection = window.getSelection();
	if (container === null || selection === null || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	if (range.collapsed || !container.contains(range.commonAncestorContainer)) return null;
	const mention = mentionPath(path, cwd);
	const start = lineNumberOf(range.startContainer);
	const end = lineNumberOf(range.endContainer);
	if (start !== null && end !== null && content !== undefined)
	{
		return {
			kind: "selection",
			path: mention,
			range:
			{
				start,
				end,
			},
			text: content
				.split("\n")
				.slice(start - 1, end)
				.join("\n"),
			language: fileViewerLanguage(path),
		};
	}
	const text = selection.toString();
	if (text.trim() === "") return null;
	return {
		kind: "selection",
		path: mention,
		text,
		language: null,
	};
}

function errorTitle(error: unknown): string
{
	if (error instanceof ApiResponseError && error.status === 404) return "Couldn’t find this file";
	return "Can’t read this file";
}

function isFindShortcut(event: KeyboardEvent): boolean
{
	const mod = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
	return mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f";
}

/**
 * Find in file: a ⌘F bar claimed only while focus is inside the pane. Source
 * view counts matches from the file text, since virtualized rows may not be
 * mounted, and numbers the mounted rows' ranges from each line's offset;
 * rendered markdown counts what is in the DOM.
 */
function useFindInFile({
	path,
	viewerRef,
	editorRef,
	content,
	sourceMode,
	line,
	findQuery,
}: {
	path: string;
	viewerRef: RefObject<HTMLDivElement | null>;
	editorRef: RefObject<SourceEditorHandle | null>;
	content: string | undefined;
	sourceMode: boolean;
	line: number | undefined;
	findQuery: string | undefined;
})
{
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeState, setActiveState] = useState(0);
	const [anchorLine, setAnchorLine] = useState<number | null>(null);
	const [domTotal, setDomTotal] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const [scrollRequest, setScrollRequest] = useState(0);
	const scrolledRef = useRef(0);
	const [focusRequest, setFocusRequest] = useState(0);

	// A content search hit opens the bar prefilled, on the match at its line.
	const [seenTarget, setSeenTarget] = useState<
	{
		findQuery?: string;
		line?: number;
	}>({});
	if (seenTarget.findQuery !== findQuery || seenTarget.line !== line)
	{
		setSeenTarget(
			{
				...(findQuery === undefined
					? {}
					:
						{
							findQuery,
						}),
				...(line === undefined
					? {}
					:
						{
							line,
						}),
			},
		);
		if (findQuery !== undefined && findQuery !== "")
		{
			setOpen(true);
			setQuery(findQuery);
			setActiveState(0);
			setAnchorLine(line ?? null);
			setScrollRequest((request) => request + 1);
		}
	}

	const sourceMatches = useMemo(
		() => (open && sourceMode && content !== undefined ? lineMatchOffsets(content, query) : null),
		[open, sourceMode, content, query],
	);
	const total = sourceMatches?.total ?? domTotal;
	const anchored =
		sourceMatches !== null && anchorLine !== null ? firstMatchFromLine(sourceMatches, anchorLine) : activeState;
	const active = total === 0 ? 0 : Math.min(anchored, total - 1);

	useEffect(() =>
	{
		const root = viewerRef.current;
		// The source editor draws its own matches from findHighlight.
		if (!open || root === null || sourceMatches !== null) return undefined;
		const apply = () =>
		{
			const ranges = collectFindBlocks(root, query).flatMap((block) => block.ranges);
			const activeRange = ranges[active] ?? null;
			setDomTotal(ranges.length);
			paintFindHighlights(ranges, activeRange);
			if (scrolledRef.current !== scrollRequest && activeRange !== null)
			{
				scrolledRef.current = scrollRequest;
				activeRange.startContainer.parentElement?.scrollIntoView(
					{
						block: "center",
						inline: "nearest",
					},
				);
			}
		};
		apply();
		const observer = new MutationObserver(apply);
		observer.observe(
			root,
			{
				childList: true,
				subtree: true,
				characterData: true,
			},
		);
		return () =>
		{
			observer.disconnect();
			clearFindHighlights();
		};
	}, [viewerRef, open, query, active, sourceMatches, scrollRequest]);

	useEffect(() =>
	{
		if (focusRequest === 0) return;
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [focusRequest]);

	const openBar = () =>
	{
		setOpen(true);
		setFocusRequest((request) => request + 1);
	};

	useEffect(
		() =>
			registerFindInFile(path, () =>
			{
				setOpen(true);
				setFocusRequest((request) => request + 1);
			}),
		[path],
	);

	const close = () =>
	{
		setOpen(false);
		if (editorRef.current === null)
			viewerRef.current?.focus(
				{
					preventScroll: true,
				},
			);
		else editorRef.current.focus();
	};

	const changeQuery = (next: string) =>
	{
		setQuery(next);
		setActiveState(0);
		setAnchorLine(null);
		setScrollRequest((request) => request + 1);
	};

	const step = (direction: 1 | -1) =>
	{
		setActiveState(stepMatch(active, total, direction));
		setAnchorLine(null);
		setScrollRequest((request) => request + 1);
	};

	const handlePaneKeyDown = (event: KeyboardEvent) =>
	{
		if (!isFindShortcut(event)) return;
		event.preventDefault();
		event.stopPropagation();
		openBar();
	};

	return {
		handlePaneKeyDown,
		findHighlight:
			sourceMatches === null
				? null
				: (
					{
						query,
						active,
						nonce: scrollRequest,
					} satisfies FindHighlight),
		bar: open ? (
			<FindBar
				inputRef={inputRef}
				query={query}
				active={active}
				total={total}
				onQueryChange={changeQuery}
				onStep={step}
				onClose={close}
			/>
		) : null,
	};
}

/**
 * The one file viewer, used by the Files pane and the full-page `/file/$`
 * route: a Copy path breadcrumb, rendered markdown with a View source toggle,
 * Shiki source with wrap and tab size from the Files ⋯ menu, images, and the
 * binary / too-large states.
 */
export function FileView({
	path,
	cwd,
	line,
	endLine,
	findQuery,
	hashNavigation = false,
	onOpenFile,
	onAttachContext,
	onEditStart,
	onDirtyChange,
}: FileViewProps)
{
	const {settings} = useSettings();
	const [forceText, setForceText] = useState(false);
	const [showSource, setShowSource] = useState(false);
	const isImage = imageContentType(path) !== null;
	const markdown = isMarkdownPath(path);
	const file = useQuery(
		{
			...fileViewQueryOptions(path, forceText),
			enabled: !isImage,
		},
	);
	const viewerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<SourceEditorHandle>(null);
	const [menuSelection, setMenuSelection] = useState<ContextAttachment | null>(null);
	const [menuEditorText, setMenuEditorText] = useState<string | null>(null);
	const [goToLine, setGoToLine] = useState<
	{
		focusRequest: number;
	} | null>(null);
	const [caret, setCaret] = useState(
		{
			line: 1,
			lines: 1,
		},
	);
	const attachKeys = useShortcutKeys("attach_selection");
	const textData = file.data?.kind === "text" ? file.data : undefined;
	const content = textData?.content;
	// Upstream's desktop local session: a writable text file edits in place, with no Edit button.
	const editable = textData?.writable === true;
	const lossy = editable && textData.lossy === true;
	const sourceSave = useSourceFileSave(
		{
			path,
			queryKey: fileViewQueryOptions(path, forceText).queryKey,
			file:
				textData === undefined
					? undefined
					:
						{
							content: textData.content,
							etag: textData.etag ?? null,
						},
			editable,
			lossy,
			editorRef,
			onEditStart,
			onDirtyChange,
		},
	);
	const edit = useMarkdownEdit(
		{
			path,
			target: markdown && content !== undefined && !editable ? editableMarkdownTarget(path) : null,
			fileVersion: file.dataUpdatedAt,
			onEditStart,
			onDirtyChange,
		},
	);
	const sourceMode = edit.editor === null && content !== undefined && content !== "" && (!markdown || showSource);
	// detectLanguage leaves markdown out for diffs; source mode still highlights it like upstream.
	const language = fileViewerLanguage(path) ?? (markdown ? "markdown" : null);
	const tokens = useHighlightedLines(sourceMode ? content : "", language);
	const find = useFindInFile(
		{
			path,
			viewerRef,
			editorRef,
			content,
			sourceMode,
			line,
			findQuery,
		},
	);

	const openGoToLine = () =>
	{
		setGoToLine((bar) => (
		{
			focusRequest: (bar?.focusRequest ?? 0) + 1,
		}));
	};

	const closeGoToLine = (refocus: boolean) =>
	{
		setGoToLine(null);
		if (refocus) editorRef.current?.focus();
	};

	const editorMenu = (): SourceEditorMenuActions | undefined =>
		menuEditorText === null
			? undefined
			:
				{
					selectedText: menuEditorText,
					onSelectAll: () =>
					{
						editorRef.current?.selectAll();
						editorRef.current?.focus();
					},
					onGoToLine: openGoToLine,
				};

	useShortcut(
		"attach_selection",
		() =>
		{
			const attachment = selectionAttachment(viewerRef.current, path, cwd, content, editorRef.current);
			if (attachment === null) return false;
			onAttachContext?.(attachment);
			return true;
		},
		{
			disabled: onAttachContext === undefined,
		},
	);

	const openSiblingLink = (event: MouseEvent<HTMLDivElement>) =>
	{
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
		const anchor = event.target instanceof Element ? event.target.closest("a") : null;
		const href = anchor?.getAttribute("href");
		if (onOpenFile === undefined || !href?.startsWith(`${SIBLING_MD_BASE}/`)) return;
		event.preventDefault();
		const slug = decodeURIComponent(href.slice(SIBLING_MD_BASE.length + 1).split("#")[0] ?? "");
		onOpenFile(`${directoryOf(path)}/${fromMdSlug(slug)}`);
	};

	const body = (): ReactNode =>
	{
		if (edit.editor !== null) return edit.editor;
		if (isImage) return <ImageView path={path} />;
		if (file.isPending) return <ViewerMessage title="Loading file" />;
		if (file.isError) return <ViewerMessage title={errorTitle(file.error)} detail={path} fileName={path} />;
		const data = file.data;
		if (data.kind === "binary")
		{
			return (
				<ViewerMessage title="This file looks like binary data and can’t be previewed as text." fileName={path}>
					<button
						type="button"
						className={MESSAGE_BUTTON}
						onClick={() =>
						{
							setForceText(true);
						}}
					>
						View as text anyway
					</button>
				</ViewerMessage>
			);
		}
		if (data.kind === "too-large")
		{
			return (
				<ViewerMessage
					title={`${data.type} · ${formatFileSize(data.size)}`}
					detail="It’s too large to preview here."
					fileName={path}
				>
					<a
						href={fileContentUrl(
							path,
							{
								download: true,
							},
						)}
						download
						className={MESSAGE_BUTTON}
					>
						Download
					</a>
				</ViewerMessage>
			);
		}
		if (data.content === "") return <ViewerMessage title="This file is empty." />;
		if (markdown && !showSource)
		{
			return (
				// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegates clicks from the rendered links inside it, which are keyboard-reachable themselves
				<div className="p-4" onClick={openSiblingLink}>
					<div className="mx-auto max-w-[860px]">
						<DocumentDiagrams>
							{onOpenFile === undefined ? (
								<MarkdownArticle markdown={data.content} diagrams />
							) : (
								<LinkedMarkdown markdown={data.content} path={path} cwd={cwd} onOpenFile={onOpenFile} />
							)}
						</DocumentDiagrams>
					</div>
				</div>
			);
		}
		const tabSize = normalizeFileTabSize(settings.filesTabSize);
		const viewerHostProps =
		{
			dir: "ltr",
			style: VIEWER_HOST_STYLE,
			"data-file-viewer": "true",
			"data-find-query": findQuery,
		};
		// Upstream's EpitaxyCodeMirrorFile chain; the static Shiki viewer stands in while the editor chunk loads.
		return (
			<div
				className="epitaxy-diff epitaxy-file-rows min-h-0 flex-1 overflow-hidden"
				style={
				{
					"--diffs-tab-size": tabSize,
				}}
			>
				<div className="relative h-full min-h-0 flex-1">
					<Suspense
						fallback={
							<div {...viewerHostProps} className={VIEWER_HOST_CLASS}>
								<FileViewer
									file={data}
									wrap={settings.filesWordWrap}
									tabSize={tabSize}
									line={line}
									endLine={endLine}
									hashNavigation={hashNavigation}
								/>
							</div>
						}
					>
						{/* Upstream mounts .cm-editor directly in [data-file-viewer], which contains its size and layout. */}
						<LazySourceEditor
							ref={editorRef}
							className={VIEWER_HOST_CLASS}
							hostProps={viewerHostProps}
							value={data.content}
							readOnly={!editable}
							autoSave={editable && sourceSave.autoSave}
							onChange={sourceSave.onChange}
							onSave={sourceSave.onSave}
							onDiscard={sourceSave.discard}
							wordWrap={settings.filesWordWrap}
							indentGuides={settings.filesIndentGuides}
							tabSize={tabSize}
							showWhitespace={settings.filesShowWhitespace}
							scrollPastEnd={settings.filesScrollPastEnd}
							tokens={tokens}
							language={language}
							line={line}
							endLine={endLine}
							hashNavigation={hashNavigation}
							findHighlight={find.findHighlight}
							onGoToLine={openGoToLine}
							onCaretChange={(caretLine, lines) =>
							{
								setCaret(
									{
										line: caretLine,
										lines,
									},
								);
							}}
						/>
					</Suspense>
				</div>
			</div>
		);
	};

	const canToggleSource = markdown && file.data?.kind === "text" && !edit.editing;
	// Upstream's manual mode (autosave off, or a lossy file): Cancel and Save replace the header buttons while dirty.
	const manualDirty = editable && !sourceSave.autoSave && sourceSave.dirty;
	const showLossyNotice = lossy && sourceMode && !(sourceSave.dirty && sourceSave.error !== null);
	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- catches the editor and find shortcuts bubbling up from the focused pane content
		<div
			className="flex min-h-0 flex-1 flex-col"
			onKeyDown={(event) =>
			{
				edit.handleKeyDown(event);
				find.handlePaneKeyDown(event);
			}}
		>
			<div className="flex h-8 shrink-0 items-center gap-1 px-3">
				<Breadcrumb path={displayPath(path, cwd)} />
				{manualDirty && (
					<>
						<button
							type="button"
							disabled={sourceSave.saving}
							onMouseDown={(event) =>
							{
								event.preventDefault();
							}}
							onClick={sourceSave.discard}
							className={cdsButtonClass("ghost")}
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={sourceSave.saving || sourceSave.error !== null}
							onMouseDown={(event) =>
							{
								event.preventDefault();
							}}
							onClick={sourceSave.save}
							className={cdsButtonClass("secondary")}
						>
							Save
						</button>
					</>
				)}
				{!manualDirty && edit.editButton}
				{!manualDirty && edit.toolbar}
				{!manualDirty && canToggleSource && (
					<Tooltip content={showSource ? "Preview" : "View source"}>
						<button
							type="button"
							aria-label={showSource ? "Preview" : "View source"}
							onClick={() =>
							{
								setShowSource((shown) => !shown);
							}}
							className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary"
						>
							{showSource ? (
								<Eye aria-hidden="true" className="size-4" />
							) : (
								<Code aria-hidden="true" className="size-4" />
							)}
						</button>
					</Tooltip>
				)}
			</div>
			{showLossyNotice && (
				<div role="status" className="shrink-0 bg-alpha-2 px-md py-1.25 text-body text-primary">
					{sourceSave.autoSavePref
						? "This file isn’t valid UTF-8, so it’s saved only when you press Save. A save writes each \uFFFD to the file, and the original characters are lost."
						: "This file isn’t valid UTF-8. A save writes each \uFFFD to the file, and the original characters are lost."}
				</div>
			)}
			{sourceMode && goToLine !== null && (
				<GoToLineBar
					caret={caret}
					focusRequest={goToLine.focusRequest}
					onGo={(target, column) =>
					{
						editorRef.current?.goTo(target, column);
						setGoToLine(null);
					}}
					onClose={closeGoToLine}
				/>
			)}
			<div className="relative flex min-h-0 flex-1 flex-col">
				{find.bar}
				{edit.banner}
				{editable && sourceMode && sourceSave.dirty && sourceSave.error !== null && (
					<SaveErrorBanner
						error={sourceSave.error}
						busy={sourceSave.saving}
						inPaneHeaderLine={false}
						onDiscard={sourceSave.discard}
						onRetry={sourceSave.retry}
					/>
				)}
				<ContextMenu>
					<ContextMenuTrigger
						render={<div ref={viewerRef} />}
						tabIndex={-1}
						{...(sourceMode
							?
								{
									role: "group",
								}
							:
								{
									"data-file-viewer": "true",
									"data-find-query": findQuery,
								})}
						className={`min-h-0 flex-1 outline-none select-text ${sourceMode ? "flex flex-col" : "overflow-auto"}`}
						onContextMenu={() =>
						{
							const editor = editorRef.current;
							setMenuEditorText(editor === null ? null : editor.selectedText());
							setMenuSelection(selectionAttachment(viewerRef.current, path, cwd, content, editor));
						}}
					>
						{body()}
					</ContextMenuTrigger>
					<MenuContent popupProps={SUPPRESS_NATIVE_MENU_POPUP_PROPS}>
						<ViewerMenuItems
							path={path}
							cwd={cwd}
							content={content}
							line={line ?? 1}
							attachment={() =>
								menuSelection ??
								{
									kind: "file",
									path: mentionPath(path, cwd),
								}
							}
							onAttachContext={onAttachContext}
							attachShortcut={attachKeys.keys}
							editor={editorMenu()}
						/>
					</MenuContent>
				</ContextMenu>
			</div>
		</div>
	);
}
