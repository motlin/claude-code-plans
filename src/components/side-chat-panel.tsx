import {useNavigate} from "@tanstack/react-router";
import {ArrowUp, Check, Copy, ExternalLink, GitBranch, Info, PanelRight, Square, Trash2, X} from "lucide-react";
import {type KeyboardEvent, type ReactNode, useEffect, useRef, useState} from "react";

import {useBandEnter} from "../hooks/use-band-enter";
import {useShortcutKeys} from "../hooks/use-shortcut";
import {insertAtCaret} from "../hooks/use-type-to-focus";
import {writeClipboardText} from "../lib/clipboard";
import {isButtonish, isEditableTarget, isInModalLayer} from "../lib/shortcuts/match";
import
{
	askSideChat,
	branchSideChatEntry,
	clearSideChat,
	closeSideChat,
	removeSideChatExcerpt,
	type SideChatEntry,
	type SideChatExcerpt,
	setSideChatMode,
	stopEntry,
	useSideChat,
} from "../lib/side-chat-store";
import {CARD_BODY_CLASS, CARD_CLASS, CARD_FILL_CLASS, TILE_CLASS, TILE_REMOVE_CLASS} from "./attachment-tile-classes";
import {MarkdownArticle} from "./markdown-article";
import {ExcerptQuote} from "./excerpt-quote";
import {MessageExcerptTiles} from "./message-excerpt-tiles";
import {PaneHeaderRow} from "./panes/pane-header-row";
import type {PaneChrome} from "./panes/pane-registry";
import {SideChatTabStrip} from "./side-chat-tab-strip";
import {useToast} from "./toast-context";
import {Shortcut} from "./ui/shortcut";
import {Tooltip} from "./ui/tooltip";
import {useTimedFlag} from "../hooks/use-timed-flag";

const ICON_BUTTON_CLASS =
	"flex size-6 shrink-0 items-center justify-center rounded-r5 text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40";

const ANSWER_ACTION_CLASS =
	"flex items-center gap-1 rounded-r5 px-1.5 py-0.5 text-caption text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-primary disabled:pointer-events-none disabled:opacity-40";

export type SideChatVariant = "floating" | "docked" | "popout";

/** Upstream `$M`'s reset commands: typed as the question, they clear the thread instead of asking. */
const RESET_COMMAND = /^\/(?:clear|reset|new)(?:\s|$)/i;

const EMPTY_NOTE =
	"Chat about this session without touching the main thread. Claude sees the full context, and nothing here is added to the session.";

/** The side chat's header, context strip, Q/A thread and input, shared by every variant. */
export function SideChatPanel({
	sessionId,
	messageCount,
	variant,
	active,
	canDock,
	chrome,
}: {
	sessionId: string;
	messageCount: number;
	variant: SideChatVariant;
	/** Visible and interactive; the input takes focus when this turns on. */
	active: boolean;
	canDock: boolean;
	chrome?: PaneChrome;
})
{
	const {entries, excerpts} = useSideChat(sessionId);
	const shortcut = useShortcutKeys("toggle_side_chat");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const listRef = useRef<HTMLOListElement>(null);
	// The empty-state note fades in as upstream's epitaxy-band-enter when /clear brings it back.
	const bandSlot = useBandEnter<HTMLDivElement>();
	const [draft, setDraft] = useState("");
	const pendingEntry = entries.find((entry) => entry.status === "pending");
	const pending = pendingEntry !== undefined;
	const workingStatus = pendingEntry === undefined ? null : pendingEntry.stopping === true ? "Stopping…" : "Working";
	const lastEntry = entries.at(-1);

	// Opening, and each excerpt the transcript selection bar sends, lands focus in the input.
	useEffect(() =>
	{
		if (active) inputRef.current?.focus();
	}, [active, excerpts.length]);

	useEffect(() =>
	{
		const list = listRef.current;
		if (list !== null) list.scrollTop = list.scrollHeight;
	}, [lastEntry?.answer, entries.length]);

	function send()
	{
		const question = draft.trim();
		if (RESET_COMMAND.test(question))
		{
			setDraft("");
			clearSideChat(sessionId);
			return;
		}
		if (question === "" || pending) return;
		setDraft("");
		void askSideChat(sessionId, question);
	}

	/**
	 * Upstream `$M`'s key capture: Escape stops a reply that is still working and
	 * otherwise closes the side chat; a printable key pressed on a non-editable
	 * spot in the pane types into the input.
	 */
	function onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>)
	{
		const target = event.target instanceof Element ? event.target : null;
		if (event.nativeEvent.isComposing || isInModalLayer(target)) return;
		if (event.key === "Escape")
		{
			event.preventDefault();
			event.stopPropagation();
			if (pendingEntry !== undefined && pendingEntry.stopping !== true)
				void stopEntry(sessionId, pendingEntry.id);
			else closeSideChat(sessionId);
			return;
		}
		const input = inputRef.current;
		if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
		if (input === null || isEditableTarget(target)) return;
		if (event.key === " " && isButtonish(target)) return;
		event.preventDefault();
		input.focus();
		insertAtCaret(input, event.key);
	}

	const thread =
		entries.length > 0 ? (
			<ol
				ref={listRef}
				className={
					variant === "docked"
						? "flex-1 min-h-0 overflow-y-auto flex flex-col gap-[var(--chat-turn-gap)] px-lg pt-md pb-[24px]"
						: "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3"
				}
			>
				{entries.map((entry) => (
					<SideChatItem key={entry.id} sessionId={sessionId} entry={entry} />
				))}
			</ol>
		) : variant === "docked" ? (
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-md pb-sm">
				<div
					role="note"
					className="flex gap-[5px] w-full p-[8px] rounded-r7 bg-alpha-1 items-start min-h-[calc(var(--cds-h-control)+16px)] py-[calc((var(--cds-h-control)+16px-1lh)/2)] text-body band-enter mt-auto shrink-0"
				>
					<span className="flex h-[1lh] shrink-0 items-center">
						<Info className="size-3.5 text-muted-as-secondary" aria-hidden="true" />
					</span>
					<div className="flex min-w-0 flex-1 flex-wrap gap-x-sm gap-y-sm items-start">
						<div className="min-w-0 max-w-full flex-auto">
							<span className="block text-muted-as-secondary text-pretty select-text">{EMPTY_NOTE}</span>
						</div>
					</div>
				</div>
			</div>
		) : (
			variant === "popout" && <div className="flex-1" />
		);

	const composer = (
		<div
			className={
				variant === "docked"
					? "shrink-0 px-md pb-md flex flex-col gap-1.5"
					: "flex flex-col gap-2 border-t-[0.5px] border-strong p-2"
			}
		>
			{excerpts.length > 0 && (
				<ul aria-label="Attached excerpts" className="flex flex-wrap gap-1.5 pt-2 pe-2">
					{excerpts.map((excerpt) => (
						<ExcerptTile key={excerpt.id} sessionId={sessionId} excerpt={excerpt} />
					))}
				</ul>
			)}
			<div className="flex items-end gap-1">
				<textarea
					ref={inputRef}
					aria-label="Side chat question"
					value={draft}
					rows={1}
					placeholder={entries.length > 0 ? "Follow up…" : "Ask a quick question…"}
					onChange={(event) =>
					{
						setDraft(event.target.value);
					}}
					onKeyDown={(event) =>
					{
						if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing)
						{
							event.preventDefault();
							send();
						}
					}}
					className="block max-h-40 min-h-6 w-full resize-none bg-transparent px-1 py-0.5 text-body text-primary [field-sizing:content] placeholder:text-t6 focus:outline-none"
				/>
				{pending ? (
					<Tooltip content="Stop">
						<button
							type="button"
							aria-label="Stop"
							className={ICON_BUTTON_CLASS}
							onClick={() =>
							{
								if (lastEntry !== undefined) void stopEntry(sessionId, lastEntry.id);
							}}
						>
							<Square className="size-3" fill="currentColor" aria-hidden="true" />
						</button>
					</Tooltip>
				) : (
					<Tooltip content="Send" shortcut="enter">
						<button
							type="button"
							aria-label="Send"
							className={ICON_BUTTON_CLASS}
							disabled={draft.trim() === ""}
							onClick={send}
						>
							<ArrowUp className="size-4" aria-hidden="true" />
						</button>
					</Tooltip>
				)}
			</div>
		</div>
	);

	if (variant === "docked")
	{
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<PaneHeaderRow
					label="Side chat"
					title={<SideChatTabStrip sessionId={sessionId} status={workingStatus} />}
					actions={chrome?.controls}
					moveHandle={chrome?.moveHandle}
				/>
				<div
					tabIndex={-1}
					role="group"
					aria-label="Side chat"
					data-side-session-pane=""
					data-escape-owner=""
					ref={bandSlot}
					className="epitaxy-side-chat flex h-full min-h-0 flex-col pt-md outline-none"
					onKeyDownCapture={onKeyDownCapture}
				>
					{thread}
					{composer}
				</div>
			</div>
		);
	}

	return (
		<div data-side-session-pane="" className="flex min-h-0 flex-1 flex-col" onKeyDownCapture={onKeyDownCapture}>
			<header className="relative flex items-center gap-1 border-b-[0.5px] border-strong px-3 py-2">
				<h2 className="flex-1 truncate text-body font-medium text-primary">Side chat</h2>
				{variant === "floating" && <Shortcut keys={shortcut.keys} className="mr-1" />}
				{variant === "floating" && entries.length > 0 && (
					<HeaderButton
						label="Clear side chat"
						onClick={() =>
						{
							clearSideChat(sessionId);
						}}
					>
						<Trash2 className="size-3.5" aria-hidden="true" />
					</HeaderButton>
				)}
				{variant === "floating" && canDock && (
					<HeaderButton
						label="Dock side chat"
						onClick={() =>
						{
							setSideChatMode(sessionId, "docked");
						}}
					>
						<PanelRight className="size-3.5" aria-hidden="true" />
					</HeaderButton>
				)}
				{variant === "floating" && (
					<HeaderButton
						label="Open in new window"
						onClick={() =>
						{
							setSideChatMode(sessionId, "popout");
						}}
					>
						<ExternalLink className="size-3.5" aria-hidden="true" />
					</HeaderButton>
				)}
				<HeaderButton
					label="Close side chat"
					ariaKeyShortcuts={variant === "popout" ? undefined : shortcut.ariaKeyShortcuts}
					onClick={() =>
					{
						closeSideChat(sessionId);
					}}
				>
					<X className="size-4" aria-hidden="true" />
				</HeaderButton>
			</header>
			<p className="border-b-[0.5px] border-strong px-3 py-1.5 text-caption text-t6">
				Sees {messageCount} messages from main chat · read-only
			</p>
			{thread}
			{composer}
		</div>
	);
}

/** A pending excerpt as upstream's 120px Excerpt quote tile, with its hover remove button. */
function ExcerptTile({sessionId, excerpt}: {sessionId: string; excerpt: SideChatExcerpt})
{
	return (
		<li data-cds="MessageAttachmentsQuote" data-cds-attachment="" className={TILE_CLASS}>
			<div data-cds="Card" data-size="xs" className={CARD_CLASS}>
				<span aria-hidden="true" className={CARD_FILL_CLASS} />
				<div data-cds-card-body="" className={CARD_BODY_CLASS}>
					<ExcerptQuote text={excerpt.text} label="Excerpt" />
				</div>
			</div>
			<button
				type="button"
				aria-label={`Remove ${excerpt.text}`}
				onMouseDown={(event) =>
				{
					event.preventDefault();
				}}
				onClick={() =>
				{
					removeSideChatExcerpt(sessionId, excerpt.id);
				}}
				className={TILE_REMOVE_CLASS}
			>
				<X aria-hidden="true" className="size-3" />
			</button>
		</li>
	);
}

function HeaderButton({
	label,
	ariaKeyShortcuts,
	onClick,
	children,
}: {
	label: string;
	ariaKeyShortcuts?: string | undefined;
	onClick: () => void;
	children: ReactNode;
})
{
	return (
		<Tooltip content={label} side="bottom">
			<button
				type="button"
				aria-label={label}
				aria-keyshortcuts={ariaKeyShortcuts}
				className={ICON_BUTTON_CLASS}
				onClick={onClick}
			>
				{children}
			</button>
		</Tooltip>
	);
}

function pendingLabel(entry: SideChatEntry): string
{
	if (entry.stopping === true) return "Stopping…";
	return entry.activity ?? "Thinking…";
}

function SideChatItem({sessionId, entry}: {sessionId: string; entry: SideChatEntry})
{
	const navigate = useNavigate();
	const toast = useToast();
	const [copied, showCopied] = useTimedFlag(1500);

	async function copy()
	{
		if (await writeClipboardText(entry.answer))
		{
			showCopied();
		}
	}

	async function branch()
	{
		try
		{
			const forkedId = await branchSideChatEntry(sessionId, entry.id);
			if (forkedId === null)
			{
				toast(
					{
						kind: "error",
						message: "Couldn’t branch to a new chat.",
					},
				);
				return;
			}
			void navigate(
				{
					to: "/session/$id",
					params:
					{
						id: forkedId,
					},
				},
			);
		}
		catch (err)
		{
			toast(
				{
					kind: "error",
					message: "Couldn’t branch to a new chat.",
					description: err instanceof Error ? err.message : String(err),
				},
			);
		}
	}

	return (
		<li className="flex flex-col gap-1.5">
			<MessageExcerptTiles
				snippets={(entry.excerpts ?? []).map((text) => (
				{
					text,
				}))}
			/>
			<div className="self-end max-w-[85%] rounded-r7 bg-user-msg-bg px-3 py-1.5 text-body whitespace-pre-wrap break-words text-user-msg-text">
				{entry.question}
			</div>
			{entry.answer !== "" && (
				<div className="min-w-0 text-body break-words text-primary">
					<MarkdownArticle markdown={entry.answer} typographer />
				</div>
			)}
			{entry.status === "pending" && (
				<div className="flex items-center gap-2 text-caption text-t6">
					<span
						className="inline-block size-1.5 animate-pulse rounded-full bg-accent-100"
						aria-hidden="true"
					/>
					{pendingLabel(entry)}
				</div>
			)}
			{entry.status === "error" && entry.error !== undefined && (
				<p role="alert" className="text-caption text-danger-000">
					{entry.error}
				</p>
			)}
			{entry.status === "done" && (
				<div className="flex items-center gap-1">
					{entry.branching === true ? (
						<span className="px-1.5 text-caption text-t6">Forking session…</span>
					) : (
						<>
							<button
								type="button"
								aria-label="Copy answer"
								className={ANSWER_ACTION_CLASS}
								onClick={() => void copy()}
							>
								{copied ? (
									<Check className="size-3" aria-hidden="true" />
								) : (
									<Copy className="size-3" aria-hidden="true" />
								)}
								{copied ? "Copied" : "Copy"}
							</button>
							<button
								type="button"
								aria-label="Branch to new chat"
								className={ANSWER_ACTION_CLASS}
								onClick={() => void branch()}
							>
								<GitBranch className="size-3" aria-hidden="true" />
								Branch
							</button>
						</>
					)}
				</div>
			)}
		</li>
	);
}
