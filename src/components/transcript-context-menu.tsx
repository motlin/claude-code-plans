import {QueryClientContext} from "@tanstack/react-query";
import {type ComponentProps, type ReactNode, useContext, useRef, useState} from "react";

import {MIN_EXCERPT_LENGTH} from "../hooks/use-transcript-selection-attach";
import {isFileRefGone} from "../lib/api/file-refs";
import {writeClipboardText} from "../lib/clipboard";
import {CODEBLOCK_CLASS, CODEBLOCK_COPY_ATTR, CODEBLOCK_TEXT_ATTR} from "../lib/client-markdown";
import {useSessionChapters} from "../lib/chapter-store";
import {attachContext} from "../lib/context-attach";
import {markdownToPlainText} from "../lib/markdown-plain-text";
import
{
	createPressRecorder,
	SUPPRESS_NATIVE_MENU_POPUP_PROPS,
	touchOnTextOrSelection,
	wantsNativeContextMenu,
} from "../lib/native-context-menu";
import {useFileRefsCwd} from "./file-refs-context";
import {FileActionsMenuItems} from "./files/file-actions-menu";
import {ImageMenuItems} from "./image-context-menu";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem, MenuSeparator} from "./ui/menu";
import
{
	type TranscriptActions,
	TranscriptActionsContext,
	type TranscriptMessageRef,
} from "./transcript-actions-context";
import {useOpenInDefaultApp} from "./use-open-in-default-app";

/*
 * claude.ai/code's right-click menus on transcript turns: assistant prose,
 * inline code (adds Copy code), fenced code blocks (adds Copy code block, also
 * atop a tool row's menu), links (adds Open in default browser and Copy link),
 * tool rows (Pin and Fork only) and user bubbles (adds Rewind). A file
 * ref opens only the shared file actions menu, as on desktop, or, without an
 * absolute path, the prose menu led by Copy path (upstream's browser `jb`).
 * A text selection in the turn adds Copy and attaches as an Excerpt. An image
 * with no menu of its own leads the prose menu with Copy image · Save image.
 *
 * As upstream's host (`Qx`), the browser's own menu opens instead when a
 * right-click lands on the selection over a tool row (which has no Attach
 * selection row), and a touch on transcript text is left to the browser's
 * text selection rather than the long-press menu.
 */

type TranscriptMenuTarget =
	|
	  {
			kind: "prose";
	  }
	|
	  {
			kind: "file";
			path: string;
			line: number | undefined;
	  }
	|
	  {
			kind: "filePath";
			text: string;
	  }
	|
	  {
			kind: "tool";
	  }
	|
	  {
			kind: "code";
			text: string;
	  }
	|
	  {
			kind: "codeBlock";
			text: string;
			/** The block sits in a tool row's body, so the tool menu follows the row. */
			inTool: boolean;
	  }
	|
	  {
			kind: "link";
			href: string;
	  };

/**
 * Upstream `aS`'s fenced-block arm: the code card yields its `data-code-text` as a block; the block's copy chrome
 * yields nothing, and no inline-code fallback either. Undefined when `element` is outside a fenced block.
 */
function resolveCodeBlock(element: Element, fallback: "prose" | "tool"): TranscriptMenuTarget | undefined
{
	const block = element.closest(`.${CODEBLOCK_CLASS}`);
	if (block === null) return undefined;
	const inTool = fallback === "tool" || element.closest("[data-tool-row]") !== null;
	const onChrome = element.closest(`[${CODEBLOCK_COPY_ATTR}], .markdown-code-copy-rail`) !== null;
	const text = onChrome ? null : block.getAttribute(CODEBLOCK_TEXT_ATTR);
	if (text === null || text === "")
		return {
			kind: inTool ? "tool" : fallback,
		};
	return {
		kind: "codeBlock",
		text,
		inTool,
	};
}

/** What was right-clicked: a file ref, a fenced block, a tool row, a link, inline code, or else `fallback`. */
function resolveMenuTarget(element: Element | null, fallback: "prose" | "tool"): TranscriptMenuTarget
{
	if (element === null)
		return {
			kind: fallback,
		};
	const fileRef = element.closest("[data-file-ref]");
	if (fileRef !== null)
	{
		const path = fileRef.getAttribute("data-file-path");
		if (path?.startsWith("/") !== true)
			return {
				kind: "filePath",
				text: fileRef.textContent,
			};
		const line = fileRef.getAttribute("data-file-line");
		return {
			kind: "file",
			path,
			line: line === null ? undefined : Number(line),
		};
	}
	const codeBlock = resolveCodeBlock(element, fallback);
	if (codeBlock !== undefined) return codeBlock;
	if (element.closest("[data-tool-row]") !== null)
		return {
			kind: "tool",
		};
	const link = element.closest<HTMLAnchorElement>("a[href]");
	if (link !== null)
		return {
			kind: "link",
			href: link.href,
		};
	const code = element.closest("code:not(pre code)");
	if (code !== null)
		return {
			kind: "code",
			text: code.textContent,
		};
	return {
		kind: fallback,
	};
}

interface TranscriptMenuImage
{
	src: string;
	fileName: string | undefined;
}

/** Upstream `vw`'s source protocols, besides the page's own. */
const IMAGE_PROTOCOLS = new Set(["http:", "https:", "data:", "blob:"]);

/** Upstream `Tw`'s `imageFileName`: an empty attribute counts as none. */
function fileNameOf(image: HTMLImageElement): string | undefined
{
	const fileName = image.getAttribute("data-image-file-name");
	return fileName === null || fileName === "" ? undefined : fileName;
}

/**
 * Upstream `Tw`'s `imageSrc`/`imageFileName`: the right-clicked image that has no menu of its own, with its full-size
 * source, or null when there is none or its source isn't one the menu can fetch (upstream `vw`).
 */
function resolveMenuImage(element: Element | null): TranscriptMenuImage | null
{
	const image = element?.closest<HTMLImageElement>('img:not([draggable="false"])');
	if (image === null || image === undefined) return null;
	// Upstream skips empty strings here, not just missing attributes.
	const src = [image.getAttribute("data-image-original-src"), image.currentSrc, image.src].find(
		(candidate) => candidate !== null && candidate !== "",
	);
	if (src === undefined || src === null) return null;
	try
	{
		const protocol = new URL(src, image.baseURI).protocol;
		if (!IMAGE_PROTOCOLS.has(protocol) && protocol !== image.ownerDocument.defaultView?.location.protocol)
			return null;
	}
	catch
	{
		return null;
	}
	return {
		src,
		fileName: fileNameOf(image),
	};
}

/**
 * Upstream `ux`'s `selectionText`: the document selection when it reaches into
 * `turn`, or null when there is none or it is blank.
 */
function snapshotSelection(turn: Element): string | null
{
	const selection = turn.ownerDocument.getSelection();
	if (selection === null || selection.isCollapsed) return null;
	const text = selection.toString();
	if (text.trim() === "") return null;
	for (let index = 0; index < selection.rangeCount; index++)
	{
		if (selection.getRangeAt(index).intersectsNode(turn)) return text;
	}
	return null;
}

/** Upstream `Kn`'s `beforeOpen`: the longest a file menu waits on its "is this path gone?" check. */
const GONE_CHECK_WAIT_MS = 150;

/**
 * Upstream's popup sizes to its rows (`min-w-[128px] max-w-[320px]`); these are its live widths.
 * Without Fork, Rewind or a selection both speakers' menus measured 222.93px.
 */
const MENU_WIDTH = "w-[222.9px]";

/** With "Attach selection as context ⇧⌘L" the assistant menu measured 242.4px. */
const SELECTION_MENU_WIDTH = "w-[242.4px]";

/**
 * The Fork row's footnote "Starts a new session, keeps this one" is 224.195px of text; with the
 * 10px item padding and 6px menu gutter on each side the menu measured 256.195px.
 */
const FORK_MENU_WIDTH = "w-[256.2px]";

/** The Rewind row's wrapped description fills upstream's `max-w-[320px]` popup cap. */
const REWIND_MENU_WIDTH = "w-[320px]";

/** Upstream `wx`: Rewind shows only with a rewind callback and no block reason; it is hidden, never disabled. */
function showsRewind(actions: TranscriptActions): boolean
{
	return (
		actions.rewindHidden !== true && actions.rewindTo !== undefined && actions.rewindDisabledReason === undefined
	);
}

/** Upstream `wx`: an absent fork callback omits the row; a blocked fork stays as a disabled row. */
function showsFork(actions: TranscriptActions): boolean
{
	return actions.forkFrom !== undefined || actions.forkDisabledReason !== undefined;
}

/** The width of the menu's widest row: Rewind (user only), then Fork, then Attach selection. */
function menuWidth(speaker: Speaker, actions: TranscriptActions, selection: boolean): string
{
	if (speaker === "user" && showsRewind(actions)) return REWIND_MENU_WIDTH;
	if (showsFork(actions)) return FORK_MENU_WIDTH;
	return selection ? SELECTION_MENU_WIDTH : MENU_WIDTH;
}

/** The trimmed selection to attach as an Excerpt, or "" when it is too short. */
function excerptOf(selectionText: string | null): string
{
	const excerpt = selectionText?.trim() ?? "";
	return excerpt.length >= MIN_EXCERPT_LENGTH ? excerpt : "";
}

const FORK_DESCRIPTION = "Starts a new session, keeps this one";
const REWIND_DESCRIPTION = "Takes this and what follows out of the conversation";

type Speaker = "assistant" | "user";

export interface TranscriptMessageMenuProps
{
	speaker: Speaker;
	sessionId: string;
	uuid: string | undefined;
	/** The message's text as written; empty for tool-only turns, whose right-click is the tool row menu. */
	markdown: string;
	/** The turn wrapper element the menu opens from. */
	render: ComponentProps<typeof ContextMenuTrigger>["render"];
	children: ReactNode;
}

export function TranscriptMessageMenu({
	speaker,
	sessionId,
	uuid,
	markdown,
	render,
	children,
}: TranscriptMessageMenuProps)
{
	const [target, setTarget] = useState<TranscriptMenuTarget>(
		{
			kind: "prose",
		},
	);
	const [selectionText, setSelectionText] = useState<string | null>(null);
	const [image, setImage] = useState<TranscriptMenuImage | null>(null);
	const [keyboardArticle, setKeyboardArticle] = useState<HTMLElement | null>(null);
	const closingMenu = useRef<Element | null>(null);
	const queryClient = useContext(QueryClientContext);
	const actions = useContext(TranscriptActionsContext);
	const [open, setOpen] = useState(false);
	const [gone, setGone] = useState(false);
	const goneCheck = useRef<Promise<boolean> | null>(null);
	const fallback = markdown === "" ? "tool" : "prose";
	const [pressRecorder] = useState(createPressRecorder);
	return (
		<ContextMenu
			open={open}
			onOpenChange={(nextOpen, details) =>
			{
				const check = goneCheck.current;
				if (nextOpen && check !== null)
				{
					// Upstream waits up to 150ms for the check, then opens and updates when it answers.
					void Promise.race([
						check,
						new Promise((resolve) =>
						{
							setTimeout(resolve, GONE_CHECK_WAIT_MS);
						}),
					]).then(() =>
					{
						if (goneCheck.current === check) setOpen(true);
					});
				}
				else
				{
					setOpen(nextOpen);
				}
				closingMenu.current =
					!nextOpen &&
					(details.reason === "escape-key" || details.reason === "item-press") &&
					details.event.target instanceof Element
						? details.event.target.closest('[role="menu"]')
						: null;
				if (!nextOpen) goneCheck.current = null;
			}}
		>
			<ContextMenuTrigger
				data-transcript-message-menu
				render={render}
				onPointerDown={pressRecorder.onPointerDown}
				onPointerUp={pressRecorder.onPointerUp}
				onContextMenuCapture={pressRecorder.onContextMenuCapture}
				onTouchStart={(event) =>
				{
					const touch = event.touches[0];
					if (
						event.touches.length === 1 &&
						touch !== undefined &&
						touchOnTextOrSelection(event.currentTarget, touch.clientX, touch.clientY)
					)
					{
						// Upstream opens its long-press menu only off text and the selection.
						event.preventBaseUIHandler();
					}
				}}
				onContextMenu={(event) =>
				{
					// Upstream `eT`/`yw`: a nested menu already handled it, or it bubbled out of a React portal.
					if (
						event.defaultPrevented ||
						!(event.target instanceof Node) ||
						!event.currentTarget.contains(event.target)
					)
					{
						event.preventBaseUIHandler();
						return;
					}
					const nextTarget = resolveMenuTarget(
						event.target instanceof Element ? event.target : null,
						fallback,
					);
					// Only a tool row lacks upstream's Attach selection row (`fe`).
					if (wantsNativeContextMenu(event, nextTarget.kind !== "tool"))
					{
						event.preventBaseUIHandler();
						// Keep Base UI's document listener (and any outer menu) from preventing the native menu.
						event.stopPropagation();
						return;
					}
					setTarget(nextTarget);
					setImage(resolveMenuImage(event.target instanceof Element ? event.target : null));
					setSelectionText(snapshotSelection(event.currentTarget));
					setGone(false);
					goneCheck.current = null;
					if (nextTarget.kind === "file" && queryClient !== undefined)
					{
						const check = isFileRefGone(queryClient, nextTarget.path);
						goneCheck.current = check;
						void check.then((isGone) =>
						{
							if (goneCheck.current === check) setGone(isGone);
						});
					}
					const article = event.currentTarget.closest<HTMLElement>("[data-transcript-entry-index]");
					setKeyboardArticle(
						event.button === 0 &&
							event.target === event.currentTarget &&
							article === event.currentTarget.ownerDocument.activeElement
							? article
							: null,
					);
				}}
			>
				{children}
			</ContextMenuTrigger>
			<MenuContent
				// Upstream `qw`: a right-click inside the open popup never shows the browser menu.
				popupProps={SUPPRESS_NATIVE_MENU_POPUP_PROPS}
				// A file menu keeps the default 128px minimum width, as upstream's `Un`.
				{...(target.kind === "file"
					? {}
					:
						{
							className: menuWidth(speaker, actions, excerptOf(selectionText) !== ""),
						})}
				finalFocus={
					keyboardArticle === null
						? undefined
						: () =>
							{
								const document = keyboardArticle.ownerDocument;
								const active = document.activeElement;
								if (
									closingMenu.current !== null &&
									keyboardArticle.isConnected &&
									(active === document.body || closingMenu.current.contains(active))
								)
								{
									// Base UI otherwise descends from this tabIndex=-1 article to its first link.
									keyboardArticle.focus(
										{
											preventScroll: true,
										},
									);
								}
								return false;
							}
				}
			>
				<TranscriptMenuItems
					speaker={speaker}
					target={target}
					selectionText={selectionText}
					image={image}
					markdown={markdown}
					message={
						uuid === undefined
							? undefined
							:
								{
									sessionId,
									uuid,
								}
					}
					sessionId={sessionId}
					gone={gone}
				/>
			</MenuContent>
		</ContextMenu>
	);
}

function copy(text: string): void
{
	void writeClipboardText(text);
}

function actionProps(
	action: ((message: TranscriptMessageRef) => void) | undefined,
	message: TranscriptMessageRef | undefined,
)
{
	if (action === undefined || message === undefined)
		return {
			disabled: true,
		};
	return {
		onSelect: () =>
		{
			action(message);
		},
	};
}

function TranscriptMenuItems({
	speaker,
	target,
	selectionText,
	image,
	markdown,
	message,
	sessionId,
	gone,
}: {
	speaker: Speaker;
	target: TranscriptMenuTarget;
	/** The text selected in this turn when the menu opened, or null. */
	selectionText: string | null;
	/** The right-clicked image with no menu of its own, or null. */
	image: TranscriptMenuImage | null;
	markdown: string;
	message: TranscriptMessageRef | undefined;
	sessionId: string;
	/** The right-clicked file ref no longer exists. */
	gone: boolean;
})
{
	const actions = useContext(TranscriptActionsContext);
	const cwd = useFileRefsCwd();
	const openInDefaultApp = useOpenInDefaultApp();
	const {userChapters} = useSessionChapters(sessionId);
	const pinned = message !== undefined && userChapters.some((chapter) => chapter.afterId === message.uuid);
	if (target.kind === "file")
	{
		return (
			<FileActionsMenuItems
				path={target.path}
				cwd={cwd}
				{...(target.line === undefined
					? {}
					:
						{
							line: target.line,
						})}
				surface="transcript"
				gone={gone}
				onAttachContext={(attachment) => attachContext(sessionId, attachment)}
				onOpenInDefaultApp={() =>
				{
					openInDefaultApp(target.path);
				}}
			/>
		);
	}
	const pin = actions.pinChapter !== undefined && (
		<MenuItem key="pin" {...actionProps(actions.pinChapter, message)}>
			{pinned ? "Unpin chapter" : "Pin as chapter"}
		</MenuItem>
	);
	const showFork = showsFork(actions);
	const fork = showFork && (
		<MenuItem
			key="fork"
			description={FORK_DESCRIPTION}
			{...(actions.forkDisabledReason === undefined
				? actionProps(actions.forkFrom, message)
				:
					{
						disabled: true,
						disabledReason: actions.forkDisabledReason,
					})}
		>
			Fork from here
		</MenuItem>
	);

	const copyCodeBlock = target.kind === "codeBlock" && (
		<MenuItem
			onSelect={() =>
			{
				copy(target.text);
			}}
		>
			Copy code block
		</MenuItem>
	);
	if (target.kind === "tool" || (target.kind === "codeBlock" && target.inTool))
	{
		// Upstream `se`: the code row closes its own group before the tool menu's Pin.
		return (
			<>
				{copyCodeBlock}
				{copyCodeBlock !== false && (pin !== false || showFork) && <MenuSeparator />}
				{pin}
				{pin !== false && showFork && <MenuSeparator />}
				{fork}
			</>
		);
	}

	const excerpt = excerptOf(selectionText);
	return (
		<>
			{image !== null && <ImageMenuItems src={image.src} fileName={image.fileName} />}
			{selectionText !== null && (
				<MenuItem
					shortcut="cmd+c"
					onSelect={() =>
					{
						copy(selectionText);
					}}
				>
					Copy
				</MenuItem>
			)}
			{target.kind === "filePath" && (
				<MenuItem
					onSelect={() =>
					{
						copy(target.text);
					}}
				>
					Copy path
				</MenuItem>
			)}
			{target.kind === "code" && (
				<MenuItem
					onSelect={() =>
					{
						copy(target.text);
					}}
				>
					Copy code
				</MenuItem>
			)}
			{copyCodeBlock}
			{target.kind === "link" && (
				<>
					<MenuItem onSelect={() => window.open(target.href, "_blank", "noopener,noreferrer")}>
						Open in default browser
					</MenuItem>
					<MenuItem
						onSelect={() =>
						{
							copy(target.href);
						}}
					>
						Copy link
					</MenuItem>
				</>
			)}
			{/* Upstream `ie`: the image, selection, code, path and link rows share one group and one separator. */}
			{(image !== null || selectionText !== null || target.kind !== "prose") && <MenuSeparator />}
			<MenuItem
				onSelect={() =>
				{
					copy(speaker === "user" ? markdown : markdownToPlainText(markdown));
				}}
			>
				Copy message
			</MenuItem>
			<MenuItem
				onSelect={() =>
				{
					copy(markdown);
				}}
			>
				Copy message as Markdown
			</MenuItem>
			<MenuSeparator />
			{excerpt === "" ? (
				<MenuItem
					onSelect={() =>
						attachContext(
							sessionId,
							{
								kind: "message",
								text: markdown,
							},
						)
					}
				>
					Attach message as context
				</MenuItem>
			) : (
				<MenuItem
					shortcut="shift+cmd+l"
					onSelect={() =>
					{
						window.getSelection()?.removeAllRanges();
						attachContext(
							sessionId,
							{
								kind: "excerpt",
								text: excerpt,
							},
						);
					}}
				>
					Attach selection as context
				</MenuItem>
			)}
			{speaker === "assistant" ? (
				<>
					{pin}
					{showFork && <MenuSeparator />}
					{fork}
				</>
			) : (
				// Upstream `wx` returns null, separator and all, when neither row shows.
				(showsRewind(actions) || showFork) && (
					<>
						<MenuSeparator />
						{showsRewind(actions) && (
							<MenuItem description={REWIND_DESCRIPTION} {...actionProps(actions.rewindTo, message)}>
								Rewind to here
							</MenuItem>
						)}
						{fork}
					</>
				)
			)}
		</>
	);
}
