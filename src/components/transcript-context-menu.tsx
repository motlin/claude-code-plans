import {type QueryClient, QueryClientContext} from "@tanstack/react-query";
import {type ComponentProps, type ReactNode, useContext, useRef, useState} from "react";

import {type ReadAloudStatus, useReadAloud} from "../hooks/use-read-aloud";
import {MIN_EXCERPT_LENGTH} from "../hooks/use-transcript-selection-attach";
import {fileRefStatusQueryOptions} from "../lib/api/file-refs";
import {writeClipboardText} from "../lib/clipboard";
import {attachContext} from "../lib/context-attach";
import {markdownToPlainText} from "../lib/markdown-plain-text";
import {useFileRefsCwd} from "./file-refs";
import {FileActionsMenuItems} from "./files/file-actions-menu";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem, MenuSeparator} from "./ui/menu";
import {TranscriptActionsContext, type TranscriptMessageRef} from "./transcript-actions-context";
import {useOpenInDefaultApp} from "./use-open-in-default-app";

const READ_ALOUD_MENU_LABELS: Record<ReadAloudStatus, string> = {
	idle: "Read aloud",
	loading: "Stop reading aloud",
	playing: "Pause reading aloud",
	paused: "Resume reading aloud",
};

/*
 * claude.ai/code's right-click menus on transcript turns: assistant prose,
 * inline code (adds Copy code), links (adds Open in default browser and Copy
 * link), tool rows (Pin and Fork only) and user bubbles (adds Rewind). A file
 * ref opens only the shared file actions menu, as on desktop, or, without an
 * absolute path, the prose menu led by Copy path (upstream's browser `jb`).
 * A text selection in the turn adds Copy and attaches as an Excerpt.
 */

type TranscriptMenuTarget =
	| {kind: "prose"}
	| {kind: "file"; path: string; line: number | undefined}
	| {kind: "filePath"; text: string}
	| {kind: "tool"}
	| {kind: "code"; text: string}
	| {kind: "link"; href: string};

/** What was right-clicked: a tool row, a link, inline code (not a fenced block), or else `fallback`. */
function resolveMenuTarget(element: Element | null, fallback: "prose" | "tool"): TranscriptMenuTarget {
	if (element === null) return {kind: fallback};
	const fileRef = element.closest("[data-file-ref]");
	if (fileRef !== null) {
		const path = fileRef.getAttribute("data-file-path");
		if (path?.startsWith("/") !== true) return {kind: "filePath", text: fileRef.textContent};
		const line = fileRef.getAttribute("data-file-line");
		return {kind: "file", path, line: line === null ? undefined : Number(line)};
	}
	if (element.closest("[data-tool-row]") !== null) return {kind: "tool"};
	const link = element.closest<HTMLAnchorElement>("a[href]");
	if (link !== null) return {kind: "link", href: link.href};
	const code = element.closest("code:not(pre code)");
	if (code !== null) return {kind: "code", text: code.textContent};
	return {kind: fallback};
}

/**
 * Upstream `ux`'s `selectionText`: the document selection when it reaches into
 * `turn`, or null when there is none or it is blank.
 */
function snapshotSelection(turn: Element): string | null {
	const selection = turn.ownerDocument.getSelection();
	if (selection === null || selection.isCollapsed) return null;
	const text = selection.toString();
	if (text.trim() === "") return null;
	for (let index = 0; index < selection.rangeCount; index++) {
		if (selection.getRangeAt(index).intersectsNode(turn)) return text;
	}
	return null;
}

/** Upstream `Kn`'s `beforeOpen`: the longest a file menu waits on its "is this path gone?" check. */
const GONE_CHECK_WAIT_MS = 150;

/** Whether `path` no longer exists, rechecked now; a failed check counts as present. */
async function checkGone(queryClient: QueryClient, path: string): Promise<boolean> {
	try {
		return (await queryClient.query({...fileRefStatusQueryOptions(path), staleTime: 0})) === "missing";
	} catch {
		return false;
	}
}

const MENU_WIDTH = {assistant: "w-[225px]", user: "w-[249px]"} as const;

/**
 * Upstream's menu sizes to its rows; with "Attach selection as context ⇧⌘L"
 * the assistant menu measured 242.4px, while the user menu's Rewind row
 * already holds it wider.
 */
const SELECTION_MENU_WIDTH = {assistant: "w-[242.4px]", user: MENU_WIDTH.user} as const;

/** The trimmed selection to attach as an Excerpt, or "" when it is too short. */
function excerptOf(selectionText: string | null): string {
	const excerpt = selectionText?.trim() ?? "";
	return excerpt.length >= MIN_EXCERPT_LENGTH ? excerpt : "";
}

const FORK_DESCRIPTION = "Starts a new session, keeps this one";
const REWIND_DESCRIPTION = "Removes this message and what follows";

type Speaker = keyof typeof MENU_WIDTH;

export interface TranscriptMessageMenuProps {
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
}: TranscriptMessageMenuProps) {
	const readAloud = useReadAloud(markdown);
	const [target, setTarget] = useState<TranscriptMenuTarget>({kind: "prose"});
	const [selectionText, setSelectionText] = useState<string | null>(null);
	const [keyboardArticle, setKeyboardArticle] = useState<HTMLElement | null>(null);
	const closingMenu = useRef<Element | null>(null);
	const queryClient = useContext(QueryClientContext);
	const [open, setOpen] = useState(false);
	const [gone, setGone] = useState(false);
	const goneCheck = useRef<Promise<boolean> | null>(null);
	const fallback = markdown === "" ? "tool" : "prose";
	return (
		<ContextMenu
			open={open}
			onOpenChange={(nextOpen, details) => {
				const check = goneCheck.current;
				if (nextOpen && check !== null) {
					// Upstream waits up to 150ms for the check, then opens and updates when it answers.
					void Promise.race([
						check,
						new Promise((resolve) => {
							setTimeout(resolve, GONE_CHECK_WAIT_MS);
						}),
					]).then(() => {
						if (goneCheck.current === check) setOpen(true);
					});
				} else {
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
				onContextMenu={(event) => {
					const nextTarget = resolveMenuTarget(
						event.target instanceof Element ? event.target : null,
						fallback,
					);
					setTarget(nextTarget);
					setSelectionText(snapshotSelection(event.currentTarget));
					setGone(false);
					goneCheck.current = null;
					if (nextTarget.kind === "file" && queryClient !== undefined) {
						const check = checkGone(queryClient, nextTarget.path);
						goneCheck.current = check;
						void check.then((isGone) => {
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
				// A file menu keeps the default 128px minimum width, as upstream's `Un`.
				{...(target.kind === "file"
					? {}
					: {className: (excerptOf(selectionText) === "" ? MENU_WIDTH : SELECTION_MENU_WIDTH)[speaker]})}
				finalFocus={
					keyboardArticle === null
						? undefined
						: () => {
								const document = keyboardArticle.ownerDocument;
								const active = document.activeElement;
								if (
									closingMenu.current !== null &&
									keyboardArticle.isConnected &&
									(active === document.body || closingMenu.current.contains(active))
								) {
									// Base UI otherwise descends from this tabIndex=-1 article to its first link.
									keyboardArticle.focus({preventScroll: true});
								}
								return false;
							}
				}
			>
				<TranscriptMenuItems
					speaker={speaker}
					target={target}
					selectionText={selectionText}
					markdown={markdown}
					message={uuid === undefined ? undefined : {sessionId, uuid}}
					sessionId={sessionId}
					readAloud={readAloud}
					gone={gone}
				/>
			</MenuContent>
		</ContextMenu>
	);
}

function copy(text: string): void {
	void writeClipboardText(text);
}

function actionProps(
	action: ((message: TranscriptMessageRef) => void) | undefined,
	message: TranscriptMessageRef | undefined,
) {
	if (action === undefined || message === undefined) return {disabled: true};
	return {
		onSelect: () => {
			action(message);
		},
	};
}

function TranscriptMenuItems({
	speaker,
	target,
	selectionText,
	markdown,
	message,
	sessionId,
	readAloud,
	gone,
}: {
	speaker: Speaker;
	target: TranscriptMenuTarget;
	/** The text selected in this turn when the menu opened, or null. */
	selectionText: string | null;
	markdown: string;
	message: TranscriptMessageRef | undefined;
	sessionId: string;
	readAloud: ReturnType<typeof useReadAloud>;
	/** The right-clicked file ref no longer exists. */
	gone: boolean;
}) {
	const actions = useContext(TranscriptActionsContext);
	const cwd = useFileRefsCwd();
	const openInDefaultApp = useOpenInDefaultApp();
	if (target.kind === "file") {
		return (
			<FileActionsMenuItems
				path={target.path}
				cwd={cwd}
				{...(target.line === undefined ? {} : {line: target.line})}
				surface="transcript"
				gone={gone}
				onAttachContext={(attachment) => attachContext(sessionId, attachment)}
				onOpenInDefaultApp={() => {
					openInDefaultApp(target.path);
				}}
			/>
		);
	}
	const pin = (
		<MenuItem key="pin" {...actionProps(actions.pinChapter, message)}>
			Pin as chapter
		</MenuItem>
	);
	const fork = (
		<MenuItem
			key="fork"
			description={FORK_DESCRIPTION}
			{...(actions.forkDisabledReason === undefined
				? actionProps(actions.forkFrom, message)
				: {disabled: true, disabledReason: actions.forkDisabledReason})}
		>
			Fork from here
		</MenuItem>
	);

	if (target.kind === "tool") {
		return (
			<>
				{pin}
				<MenuSeparator />
				{fork}
			</>
		);
	}

	const excerpt = excerptOf(selectionText);
	return (
		<>
			{selectionText !== null && (
				<>
					<MenuItem
						shortcut="cmd+c"
						onSelect={() => {
							copy(selectionText);
						}}
					>
						Copy
					</MenuItem>
					<MenuSeparator />
				</>
			)}
			{target.kind === "filePath" && (
				<>
					<MenuItem
						onSelect={() => {
							copy(target.text);
						}}
					>
						Copy path
					</MenuItem>
					<MenuSeparator />
				</>
			)}
			{target.kind === "code" && (
				<>
					<MenuItem
						onSelect={() => {
							copy(target.text);
						}}
					>
						Copy code
					</MenuItem>
					<MenuSeparator />
				</>
			)}
			{target.kind === "link" && (
				<>
					<MenuItem onSelect={() => window.open(target.href, "_blank", "noopener,noreferrer")}>
						Open in default browser
					</MenuItem>
					<MenuItem
						onSelect={() => {
							copy(target.href);
						}}
					>
						Copy link
					</MenuItem>
					<MenuSeparator />
				</>
			)}
			<MenuItem
				onSelect={() => {
					copy(speaker === "user" ? markdown : markdownToPlainText(markdown));
				}}
			>
				Copy message
			</MenuItem>
			<MenuItem
				onSelect={() => {
					copy(markdown);
				}}
			>
				Copy message as Markdown
			</MenuItem>
			{speaker === "assistant" && (
				<MenuItem {...(readAloud.toggle === undefined ? {disabled: true} : {onSelect: readAloud.toggle})}>
					{READ_ALOUD_MENU_LABELS[readAloud.status]}
				</MenuItem>
			)}
			<MenuSeparator />
			{excerpt === "" ? (
				<MenuItem onSelect={() => attachContext(sessionId, {kind: "message", text: markdown})}>
					Attach message as context
				</MenuItem>
			) : (
				<MenuItem
					shortcut="shift+cmd+l"
					onSelect={() => {
						window.getSelection()?.removeAllRanges();
						attachContext(sessionId, {kind: "excerpt", text: excerpt});
					}}
				>
					Attach selection as context
				</MenuItem>
			)}
			{speaker === "assistant" ? (
				<>
					{pin}
					<MenuSeparator />
					{fork}
				</>
			) : (
				<>
					<MenuSeparator />
					<MenuItem
						description={REWIND_DESCRIPTION}
						{...(actions.rewindDisabledReason === undefined
							? actionProps(actions.rewindTo, message)
							: {disabled: true, disabledReason: actions.rewindDisabledReason})}
					>
						Rewind to here
					</MenuItem>
					{fork}
				</>
			)}
		</>
	);
}
