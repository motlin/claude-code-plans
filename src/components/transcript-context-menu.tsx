import {type ComponentProps, type ReactNode, useContext, useRef, useState} from "react";

import {type ReadAloudStatus, useReadAloud} from "../hooks/use-read-aloud";
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

const MENU_WIDTH = {assistant: "w-[225px]", user: "w-[249px]"} as const;

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
	const [keyboardArticle, setKeyboardArticle] = useState<HTMLElement | null>(null);
	const closingMenu = useRef<Element | null>(null);
	const fallback = markdown === "" ? "tool" : "prose";
	return (
		<ContextMenu
			onOpenChange={(open, details) => {
				closingMenu.current =
					!open &&
					(details.reason === "escape-key" || details.reason === "item-press") &&
					details.event.target instanceof Element
						? details.event.target.closest('[role="menu"]')
						: null;
			}}
		>
			<ContextMenuTrigger
				data-transcript-message-menu
				render={render}
				onContextMenu={(event) => {
					setTarget(resolveMenuTarget(event.target instanceof Element ? event.target : null, fallback));
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
				{...(target.kind === "file" ? {} : {className: MENU_WIDTH[speaker]})}
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
					markdown={markdown}
					message={uuid === undefined ? undefined : {sessionId, uuid}}
					sessionId={sessionId}
					readAloud={readAloud}
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
	markdown,
	message,
	sessionId,
	readAloud,
}: {
	speaker: Speaker;
	target: TranscriptMenuTarget;
	markdown: string;
	message: TranscriptMessageRef | undefined;
	sessionId: string;
	readAloud: ReturnType<typeof useReadAloud>;
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
		<MenuItem key="fork" description={FORK_DESCRIPTION} {...actionProps(actions.forkFrom, message)}>
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

	return (
		<>
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
			<MenuItem onSelect={() => attachContext(sessionId, {kind: "message", text: markdown})}>
				Attach message as context
			</MenuItem>
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
