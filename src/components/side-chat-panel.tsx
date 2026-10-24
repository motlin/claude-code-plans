import {useNavigate} from "@tanstack/react-router";
import {
	ArrowUp,
	Check,
	Copy,
	ExternalLink,
	GitBranch,
	PanelRight,
	PictureInPicture2,
	Square,
	Trash2,
	X,
} from "lucide-react";
import {type ReactNode, useEffect, useRef, useState} from "react";

import {useShortcutKeys} from "../hooks/use-shortcut";
import {writeClipboardText} from "../lib/clipboard";
import {
	askSideChat,
	branchSideChatEntry,
	clearSideChat,
	closeSideChat,
	type SideChatEntry,
	setSideChatMode,
	stopEntry,
	useSideChat,
} from "../lib/side-chat-store";
import {MarkdownArticle} from "./markdown-article";
import type {PaneChrome} from "./panes/pane-registry";
import {useToast} from "./toast-context";
import {Shortcut} from "./ui/shortcut";
import {Tooltip} from "./ui/tooltip";

const ICON_BUTTON_CLASS =
	"flex size-6 shrink-0 items-center justify-center rounded-r5 text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40";

const ANSWER_ACTION_CLASS =
	"flex items-center gap-1 rounded-r5 px-1.5 py-0.5 text-caption text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-primary disabled:pointer-events-none disabled:opacity-40";

export type SideChatVariant = "floating" | "docked" | "popout";

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
}) {
	const {entries} = useSideChat(sessionId);
	const shortcut = useShortcutKeys("toggle_side_chat");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const listRef = useRef<HTMLOListElement>(null);
	const [draft, setDraft] = useState("");
	const pending = entries.some((entry) => entry.status === "pending");
	const lastEntry = entries.at(-1);

	useEffect(() => {
		if (active) inputRef.current?.focus();
	}, [active]);

	useEffect(() => {
		const list = listRef.current;
		if (list !== null) list.scrollTop = list.scrollHeight;
	}, [lastEntry?.answer, entries.length]);

	function send() {
		const question = draft.trim();
		if (question === "" || pending) return;
		setDraft("");
		void askSideChat(sessionId, question);
	}

	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			onKeyDownCapture={(event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				event.stopPropagation();
				closeSideChat(sessionId);
			}}
		>
			<header className="relative flex items-center gap-1 border-b-[0.5px] border-strong px-3 py-2">
				{chrome?.moveHandle}
				<h2 className="flex-1 truncate text-body font-medium text-primary">Side chat</h2>
				{variant !== "popout" && <Shortcut keys={shortcut.keys} className="mr-1" />}
				{entries.length > 0 && (
					<HeaderButton
						label="Clear side chat"
						onClick={() => {
							clearSideChat(sessionId);
						}}
					>
						<Trash2 className="size-3.5" aria-hidden="true" />
					</HeaderButton>
				)}
				{variant === "floating" && canDock && (
					<HeaderButton
						label="Dock side chat"
						onClick={() => {
							setSideChatMode(sessionId, "docked");
						}}
					>
						<PanelRight className="size-3.5" aria-hidden="true" />
					</HeaderButton>
				)}
				{variant === "docked" && (
					<HeaderButton
						label="Undock side chat"
						onClick={() => {
							setSideChatMode(sessionId, "floating");
						}}
					>
						<PictureInPicture2 className="size-3.5" aria-hidden="true" />
					</HeaderButton>
				)}
				{variant !== "popout" && (
					<HeaderButton
						label="Open in new window"
						onClick={() => {
							setSideChatMode(sessionId, "popout");
						}}
					>
						<ExternalLink className="size-3.5" aria-hidden="true" />
					</HeaderButton>
				)}
				<HeaderButton
					label="Close side chat"
					ariaKeyShortcuts={variant === "popout" ? undefined : shortcut.ariaKeyShortcuts}
					onClick={() => {
						closeSideChat(sessionId);
					}}
				>
					<X className="size-4" aria-hidden="true" />
				</HeaderButton>
			</header>
			<p className="border-b-[0.5px] border-strong px-3 py-1.5 text-caption text-t6">
				Sees {messageCount} messages from main chat · read-only
			</p>
			{entries.length > 0 ? (
				<ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
					{entries.map((entry) => (
						<SideChatItem key={entry.id} sessionId={sessionId} entry={entry} />
					))}
				</ol>
			) : (
				variant !== "floating" && <div className="flex-1" />
			)}
			<div className="flex items-end gap-1 border-t-[0.5px] border-strong p-2">
				<textarea
					ref={inputRef}
					aria-label="Side chat question"
					value={draft}
					rows={1}
					placeholder={entries.length > 0 ? "Follow up…" : "Ask a quick question…"}
					onChange={(event) => {
						setDraft(event.target.value);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
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
							onClick={() => {
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
}) {
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

function pendingLabel(entry: SideChatEntry): string {
	if (entry.stopping === true) return "Stopping…";
	return entry.activity ?? "Thinking…";
}

function SideChatItem({sessionId, entry}: {sessionId: string; entry: SideChatEntry}) {
	const navigate = useNavigate();
	const toast = useToast();
	const [copied, setCopied] = useState(false);

	async function copy() {
		if (await writeClipboardText(entry.answer)) {
			setCopied(true);
			setTimeout(() => {
				setCopied(false);
			}, 1500);
		}
	}

	async function branch() {
		try {
			const forkedId = await branchSideChatEntry(sessionId, entry.id);
			if (forkedId === null) {
				toast({kind: "error", message: "Couldn’t branch to a new chat."});
				return;
			}
			void navigate({to: "/session/$id", params: {id: forkedId}});
		} catch (err) {
			toast({
				kind: "error",
				message: "Couldn’t branch to a new chat.",
				description: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return (
		<li className="flex flex-col gap-1.5">
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
