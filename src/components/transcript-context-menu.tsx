import {type ComponentProps, createContext, type ReactNode, useContext, useState} from "react";

import {useReadAloud} from "../hooks/use-read-aloud";
import {writeClipboardText} from "../lib/clipboard";
import {attachContext} from "../lib/context-attach";
import {markdownToPlainText} from "../lib/markdown-plain-text";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem, MenuSeparator} from "./ui/menu";

/*
 * claude.ai/code's right-click menus on transcript turns: assistant prose,
 * inline code (adds Copy code), links (adds Open in default browser and Copy
 * link), tool rows (Pin and Fork only) and user bubbles (adds Rewind).
 */

export interface TranscriptMessageRef {
	sessionId: string;
	uuid: string;
}

/** Per-message transcript actions; an item whose action is absent renders disabled. */
export interface TranscriptActions {
	pinChapter?: (message: TranscriptMessageRef) => void;
	forkFrom?: (message: TranscriptMessageRef) => void;
	rewindTo?: (message: TranscriptMessageRef) => void;
}

export const TranscriptActionsContext = createContext<TranscriptActions>({});

type TranscriptMenuTarget =
	| {kind: "prose"}
	| {kind: "tool"}
	| {kind: "code"; text: string}
	| {kind: "link"; href: string};

/** What was right-clicked: a tool row, a link, inline code (not a fenced block), or else `fallback`. */
function resolveMenuTarget(element: Element | null, fallback: "prose" | "tool"): TranscriptMenuTarget {
	if (element === null) return {kind: fallback};
	if (element.closest("[data-tool-row]") !== null) return {kind: "tool"};
	const link = element.closest<HTMLAnchorElement>("a[href]");
	if (link !== null) return {kind: "link", href: link.href};
	const code = element.closest("code:not(pre code)");
	if (code !== null) return {kind: "code", text: code.textContent ?? ""};
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
	const fallback = markdown === "" ? "tool" : "prose";
	return (
		<ContextMenu>
			<ContextMenuTrigger
				data-transcript-message-menu
				render={render}
				onContextMenu={(event) =>
					setTarget(resolveMenuTarget(event.target instanceof Element ? event.target : null, fallback))
				}
			>
				{children}
			</ContextMenuTrigger>
			<MenuContent className={MENU_WIDTH[speaker]}>
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
	return {onSelect: () => action(message)};
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
			{target.kind === "code" && (
				<>
					<MenuItem onSelect={() => copy(target.text)}>Copy code</MenuItem>
					<MenuSeparator />
				</>
			)}
			{target.kind === "link" && (
				<>
					<MenuItem onSelect={() => window.open(target.href, "_blank", "noopener,noreferrer")}>
						Open in default browser
					</MenuItem>
					<MenuItem onSelect={() => copy(target.href)}>Copy link</MenuItem>
					<MenuSeparator />
				</>
			)}
			<MenuItem onSelect={() => copy(speaker === "user" ? markdown : markdownToPlainText(markdown))}>
				Copy message
			</MenuItem>
			<MenuItem onSelect={() => copy(markdown)}>Copy message as Markdown</MenuItem>
			{speaker === "assistant" && (
				<MenuItem {...(readAloud.toggle === undefined ? {disabled: true} : {onSelect: readAloud.toggle})}>
					{readAloud.speaking ? "Stop reading aloud" : "Read aloud"}
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
					<MenuItem description={REWIND_DESCRIPTION} {...actionProps(actions.rewindTo, message)}>
						Rewind to here
					</MenuItem>
					{fork}
				</>
			)}
		</>
	);
}
