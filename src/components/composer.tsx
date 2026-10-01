import {memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from "react";
import {
	ClipboardPaste,
	CornerDownLeft,
	Ellipsis,
	FileText,
	Image as ImageIcon,
	MessageSquare,
	MessageSquareText,
	Square,
	SquareTerminal,
	TextQuote,
	X,
} from "lucide-react";

import {useComposerDraft} from "../hooks/use-composer-draft";
import {useFileMentionSuggestions} from "../hooks/use-file-mention-suggestions";
import type {LiveLaunchControls} from "../hooks/use-live-launch-options";
import {useShortcut, useShortcutKeys} from "../hooks/use-shortcut";
import type {ComposerState} from "../lib/composer-state";
import {type QueuedPrompt, queuedStatusText} from "../lib/composer-queue";
import {type HistoryNavigator, historyKeyApplies, historyNavigator} from "../lib/prompt-history";
import {uploadAttachment} from "../lib/api/attachments";
import {
	appendAttachment,
	attachContext,
	type ContextChip,
	composePrompt,
	contextChipLabel,
	formatContextAttachment,
	isLongPaste,
	registerComposer,
	removeContextChip,
	takeContextChips,
	useContextChips,
} from "../lib/context-attach";
import {
	type QueuedDiffComment,
	removeQueuedDiffComment,
	takeQueuedDiffComments,
	useDiffComments,
} from "../lib/diff-comments";
import type {SessionFilesEntry} from "../lib/api/session-files";
import {fileMentionTrigger, insertFileMention} from "../lib/file-mentions";
import type {LaunchOptions} from "../lib/launch-options";
import {filterSlashCommands, type SlashCommand, slashArgumentHint, slashQuery} from "../lib/slash-commands";
import {type ChinLaunchControls, ComposerChin} from "./composer-chin";
import {ConfirmDialog} from "./confirm-dialog";
import type {ChinMenu} from "./composer-launch-menus";
import {FileMentionMenu, fileMentionOptionId} from "./file-mention-menu";
import {SlashCommandMenu, slashCommandOptionId} from "./slash-command-menu";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "./ui/menu";
import {Tooltip} from "./ui/tooltip";

type ComposerVariant = "session" | "home";

const PLACEHOLDER: Record<ComposerVariant, string> = {
	session: "Type / for commands",
	home: "Describe a task or ask a question",
};

const CARD_CLASS =
	"relative z-[1] flex cursor-text flex-col gap-y-1.5 rounded-card bg-surface-3 p-2 shadow-[var(--composer-shadow-idle)] transition-shadow focus-within:shadow-[var(--composer-shadow-focus)]";

const EDITOR_CLASS =
	"block w-full resize-none overflow-y-auto bg-transparent py-0.5 pl-1 font-sans text-[14px]/[20px] text-primary [field-sizing:content] placeholder:text-[rgb(137,135,129)] focus:outline-none disabled:opacity-50 pointer-coarse:text-[16px]";

const ICON_BUTTON_CLASS =
	"flex aspect-square size-6 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40";

function chipLabel({path, line, endLine}: QueuedDiffComment): string {
	const name = path.slice(path.lastIndexOf("/") + 1) || path;
	return `${name}:${endLine === undefined || endLine === line ? line : `${line}-${endLine}`}`;
}

const CHIP_CLASS =
	"flex h-6 max-w-[16rem] min-w-0 items-center gap-1 rounded-r6 border border-border bg-surface-3 ps-1.5 pe-0.5 text-footnote text-secondary";

const CHIP_REMOVE_CLASS =
	"flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-r5 hover:bg-fill-ghost-hover hover:text-primary";

const CONTEXT_CHIP_ICON = {
	file: FileText,
	selection: TextQuote,
	terminal: SquareTerminal,
	image: ImageIcon,
	"pasted-text": ClipboardPaste,
	message: MessageSquareText,
} satisfies Record<ContextChip["kind"], unknown>;

function removeChip(sessionId: string, chip: ContextChip): void {
	if (chip.previewUrl !== undefined && typeof URL.revokeObjectURL === "function") {
		URL.revokeObjectURL(chip.previewUrl);
	}
	removeContextChip(sessionId, chip.id);
}

/** An attached image as a thumbnail tile with its remove button in the corner. */
function ImageChip({sessionId, chip}: {sessionId: string; chip: ContextChip}) {
	const label = contextChipLabel(chip);
	return (
		<li
			data-chip-label={label}
			title={chip.path}
			className="relative size-12 shrink-0 overflow-hidden rounded-r6 border border-border bg-surface-3"
		>
			<img src={chip.previewUrl} alt={label} className="size-full object-cover" />
			<button
				type="button"
				aria-label={`Remove ${label}`}
				onClick={() => removeChip(sessionId, chip)}
				className="absolute end-0.5 top-0.5 flex size-4 cursor-pointer items-center justify-center rounded-full bg-surface-3/90 text-secondary hover:text-primary"
			>
				<X aria-hidden="true" className="size-2.5" />
			</button>
		</li>
	);
}

/**
 * The strip above the card: ⇧⌘L context chips, uploaded images and long
 * pastes in attach order, then Changes pane comments, all waiting for the
 * next prompt and each removable.
 */
function AttachedContextChips({
	sessionId,
	context,
	comments,
}: {
	sessionId: string;
	context: readonly ContextChip[];
	comments: readonly QueuedDiffComment[];
}) {
	return (
		<ul aria-label="Attached context" className="mb-1.5 flex flex-wrap items-end gap-1">
			{context.map((chip) => {
				if (chip.kind === "image" && chip.previewUrl !== undefined) {
					return <ImageChip key={chip.id} sessionId={sessionId} chip={chip} />;
				}
				const label = contextChipLabel(chip);
				const Icon = CONTEXT_CHIP_ICON[chip.kind];
				return (
					<li
						key={chip.id}
						data-chip-label={label}
						title={formatContextAttachment(chip)}
						className={CHIP_CLASS}
					>
						<Icon aria-hidden="true" className="size-3 shrink-0" />
						<span className="min-w-0 truncate text-primary">{label}</span>
						<button
							type="button"
							aria-label={`Remove ${label}`}
							onClick={() => removeChip(sessionId, chip)}
							className={CHIP_REMOVE_CLASS}
						>
							<X aria-hidden="true" className="size-3" />
						</button>
					</li>
				);
			})}
			{comments.map((comment) => {
				const label = chipLabel(comment);
				return (
					<li key={comment.id} data-chip-label={label} title={comment.text} className={CHIP_CLASS}>
						<MessageSquare aria-hidden="true" className="size-3 shrink-0" />
						<span className="shrink-0 text-primary">{label}</span>
						<span className="min-w-0 truncate">{comment.text}</span>
						<button
							type="button"
							aria-label={`Remove comment on ${label}`}
							onClick={() => removeQueuedDiffComment(sessionId, comment.id)}
							className={CHIP_REMOVE_CLASS}
						>
							<X aria-hidden="true" className="size-3" />
						</button>
					</li>
				);
			})}
		</ul>
	);
}

/** Prompts waiting for the live session to go idle, with their chip actions. */
export interface ComposerQueueView {
	items: readonly QueuedPrompt[];
	sendNow: (id: string) => void;
	remove: (id: string) => void;
}

/**
 * claude.ai/code's queued message chips: right-aligned bubbles above the card,
 * each with an actions menu, and an sr-only count for screen readers.
 */
function QueuedPromptChips({
	items,
	onEdit,
	onSendNow,
	onRemove,
}: {
	items: readonly QueuedPrompt[];
	onEdit: (item: QueuedPrompt) => void;
	onSendNow: (id: string) => void;
	onRemove: (id: string) => void;
}) {
	return (
		<>
			<span role="status" className="sr-only">
				{items.length > 0 ? queuedStatusText(items.length) : ""}
			</span>
			{items.length > 0 && (
				<ul
					aria-label="Queued messages"
					className="mx-0 mb-1.5 flex max-h-[min(40vh,22rem)] list-none flex-col items-end gap-1 overflow-y-auto"
				>
					{items.map((item) => (
						<li
							key={item.id}
							data-queued-text={item.text}
							className="flex max-w-[85%] min-w-0 items-start gap-1 rounded-r7 bg-user-msg-bg py-1.5 ps-3 pe-1 text-body text-user-msg-text opacity-80"
						>
							<span className="line-clamp-2 min-w-0 break-words whitespace-pre-wrap">{item.text}</span>
							<Menu>
								<MenuTrigger
									aria-label="Queued message actions"
									className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary"
								>
									<Ellipsis aria-hidden="true" className="size-3.5" />
								</MenuTrigger>
								<MenuContent align="end">
									<MenuItem onSelect={() => onEdit(item)}>Edit in composer</MenuItem>
									<MenuItem onSelect={() => onSendNow(item.id)}>Send now</MenuItem>
									<MenuItem variant="danger" onSelect={() => onRemove(item.id)}>
										Remove from queue
									</MenuItem>
								</MenuContent>
							</Menu>
						</li>
					))}
				</ul>
			)}
		</>
	);
}

interface ComposerProps {
	variant: ComposerVariant;
	/** Draft storage key: the session id, or `"home"` for the new-session composer. */
	draftKey: string;
	/** `launchOptions` holds the chin's mode / model / effort picks for a fork or launch. */
	onSend: (prompt: string, launchOptions: LaunchOptions) => void;
	onCancel?: () => void;
	isStreaming?: boolean;
	/** While a live session is working, the send slot becomes Stop response. */
	onStop?: (() => void) | undefined;
	disabled?: boolean;
	deliveryHint?: string | undefined;
	/** Mode / model / effort / usage readouts; the chin stays empty without them. */
	chin?: ComposerState | undefined;
	/** Entries for the "/" autocomplete popup (`GET /api/commands`). */
	slashCommands?: readonly SlashCommand[] | undefined;
	/** Settings allow launching in Bypass permissions mode. */
	bypassPermissionsAllowed?: boolean | undefined;
	/** An idle live pane: chin picks steer it instead of becoming launch flags. */
	live?: LiveLaunchControls | undefined;
	/** The session whose working directory feeds the "@" file mention popup. */
	mentionSessionId?: string | undefined;
	/** Prompts queued while the live session works, shown as chips above the card. */
	queue?: ComposerQueueView | undefined;
	/** ⌘⏎ "Send now": interrupt the current response and send this prompt next. */
	onSendNow?: ((prompt: string) => void) | undefined;
	/** ⌥⌘⏎ "Fork with this prompt": send it to a new forked session instead of this one. */
	onFork?: ((prompt: string, launchOptions: LaunchOptions) => void) | undefined;
	/** The Send tooltip's fork row: "Fork with this prompt" or "Send in a forked session". */
	forkLabel?: string | undefined;
	/** Prior prompts, newest first, that ↑/↓ walk like a shell history. */
	promptHistory?: readonly string[] | undefined;
}

/**
 * The card's trailing Send / Stop button. Memoized on stable props, so a keystroke re-renders it only when
 * `canSend` flips.
 */
const SendSlot = memo(function SendSlot({
	isStreaming,
	onStop,
	onCancel,
	onSubmit,
	canSend,
	deliveryHint,
	hintId,
	forkLabel,
}: {
	isStreaming: boolean;
	onStop: (() => void) | undefined;
	onCancel: (() => void) | undefined;
	onSubmit: () => void;
	canSend: boolean;
	deliveryHint: string | undefined;
	hintId: string;
	/** The Send tooltip's fork row, when the composer can fork. */
	forkLabel: string | undefined;
}) {
	const forkKeys = useShortcutKeys("fork_with_prompt").keys;
	return (
		<div className="absolute right-0 bottom-0 flex min-h-6 items-center pl-1.5">
			{isStreaming || onStop !== undefined ? (
				<Tooltip content="Stop response" {...(isStreaming ? {} : {shortcut: "escape"})}>
					<button
						type="button"
						aria-label="Stop response"
						onClick={isStreaming ? onCancel : onStop}
						className={ICON_BUTTON_CLASS}
					>
						<Square className="size-3.5" fill="currentColor" aria-hidden="true" />
					</button>
				</Tooltip>
			) : (
				<Tooltip
					content="Send"
					shortcut="enter"
					secondary={forkLabel === undefined ? undefined : {content: forkLabel, shortcut: forkKeys}}
				>
					<button
						type="button"
						aria-label="Send"
						aria-describedby={deliveryHint ? hintId : undefined}
						onClick={onSubmit}
						disabled={!canSend}
						className={ICON_BUTTON_CLASS}
					>
						<CornerDownLeft className="size-4" aria-hidden="true" />
					</button>
				</Tooltip>
			)}
			{deliveryHint && (
				<span id={hintId} className="sr-only">
					{deliveryHint}
				</span>
			)}
		</div>
	);
});

const NO_COMMANDS: readonly SlashCommand[] = [];
const NO_HISTORY: readonly string[] = [];
const NO_LAUNCH_OPTIONS: LaunchOptions = {};

/**
 * The claude.ai/code ChatComposer card: an auto-growing prompt editor with a
 * trailing icon Send button and a chin row of readouts beneath.
 */
export function Composer({
	variant,
	draftKey,
	onSend,
	onCancel,
	isStreaming = false,
	onStop,
	disabled = false,
	deliveryHint,
	chin,
	slashCommands = NO_COMMANDS,
	bypassPermissionsAllowed = false,
	live,
	mentionSessionId,
	queue,
	onSendNow,
	onFork,
	forkLabel = "Fork with this prompt",
	promptHistory = NO_HISTORY,
}: ComposerProps) {
	const {text: prompt, setText: setPrompt, clear: clearDraft} = useComposerDraft(draftKey);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const hintId = useId();
	const slashMenuId = useId();
	const mentionMenuId = useId();
	const [caret, setCaret] = useState(0);
	const pendingCaretRef = useRef<number | null>(null);
	const {queued: queuedComments} = useDiffComments(draftKey);
	const contextChips = useContextChips(draftKey);
	const canSend =
		(prompt.trim() !== "" || queuedComments.length > 0 || contextChips.length > 0) && !isStreaming && !disabled;
	const [launch, setLaunch] = useState<{draftKey: string; options: LaunchOptions}>({
		draftKey,
		options: {},
	});
	const launchOptions = launch.draftKey === draftKey ? launch.options : NO_LAUNCH_OPTIONS;
	const [openMenu, setOpenMenu] = useState<ChinMenu | null>(null);
	const menuShortcutOptions = {disabled: chin === undefined};
	useShortcut("open_mode_menu", () => setOpenMenu("mode"), menuShortcutOptions);
	useShortcut("open_model_menu", () => setOpenMenu("model"), menuShortcutOptions);
	useShortcut("open_effort_selector", () => setOpenMenu("effort"), menuShortcutOptions);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [attachError, setAttachError] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);
	useShortcut("add_files", openFilePicker, {disabled});
	const chinLaunchOptions = live?.options ?? launchOptions;

	useEffect(() => {
		if (!isStreaming) textareaRef.current?.focus();
	}, [isStreaming]);

	const promptRef = useRef(prompt);
	promptRef.current = prompt;
	useEffect(
		() =>
			registerComposer(draftKey, {
				insertText: (text) => {
					const next = appendAttachment(promptRef.current, text);
					promptRef.current = next;
					setPrompt(next);
					textareaRef.current?.focus();
				},
				focus: () => textareaRef.current?.focus(),
			}),
		[draftKey, setPrompt],
	);

	const query = slashQuery(prompt);
	const [dismissedPrompt, setDismissedPrompt] = useState<string | null>(null);
	const [highlight, setHighlight] = useState({query: "", index: 0});
	const matches = query === null || dismissedPrompt === prompt ? [] : filterSlashCommands(slashCommands, query);
	const slashOpen = query !== null && matches.length > 0;
	const highlighted = highlight.query === query ? Math.min(highlight.index, matches.length - 1) : 0;
	const argumentHint = slashArgumentHint(slashCommands, prompt);

	const trigger = mentionSessionId === undefined || slashOpen ? null : fileMentionTrigger(prompt, caret);
	const mentionKey = trigger === null ? null : `${trigger.start}\0${prompt}`;
	const [dismissedMention, setDismissedMention] = useState<string | null>(null);
	const mention = mentionKey === dismissedMention ? null : trigger;
	const suggestions = useFileMentionSuggestions(mentionSessionId, mention?.query ?? null);
	const mentionEntries = suggestions?.entries ?? [];
	const mentionOpen = mention !== null && mentionEntries.length > 0;
	const [mentionHighlight, setMentionHighlight] = useState<{
		entries: readonly SessionFilesEntry[];
		index: number;
	}>({entries: [], index: 0});
	const mentionHighlighted =
		mentionHighlight.entries === mentionEntries ? Math.min(mentionHighlight.index, mentionEntries.length - 1) : 0;

	useLayoutEffect(() => {
		const next = pendingCaretRef.current;
		if (next === null) return;
		pendingCaretRef.current = null;
		textareaRef.current?.setSelectionRange(next, next);
	}, [prompt]);

	function acceptFileMention(entry: SessionFilesEntry) {
		if (mention === null) return;
		const next = insertFileMention(prompt, mention, caret, entry.relPath);
		pendingCaretRef.current = next.caret;
		setCaret(next.caret);
		setPrompt(next.text);
		textareaRef.current?.focus();
	}

	function handleMentionKey(e: React.KeyboardEvent): boolean {
		if (!mentionOpen) return false;
		const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
		if (move !== 0) {
			setMentionHighlight({
				entries: mentionEntries,
				index: (mentionHighlighted + move + mentionEntries.length) % mentionEntries.length,
			});
		} else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
			const entry = mentionEntries[mentionHighlighted];
			if (entry !== undefined) acceptFileMention(entry);
		} else if (e.key === "Escape") {
			setDismissedMention(mentionKey);
			e.stopPropagation();
		} else {
			return false;
		}
		e.preventDefault();
		return true;
	}

	function acceptSlashCommand(command: SlashCommand) {
		setPrompt(`/${command.name} `);
		textareaRef.current?.focus();
	}

	function handleSlashKey(e: React.KeyboardEvent): boolean {
		if (!slashOpen || query === null) return false;
		const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
		if (move !== 0) {
			setHighlight({query, index: (highlighted + move + matches.length) % matches.length});
		} else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
			const command = matches[highlighted];
			if (command !== undefined) acceptSlashCommand(command);
		} else if (e.key === "Escape") {
			setDismissedPrompt(prompt);
			e.stopPropagation();
		} else {
			return false;
		}
		e.preventDefault();
		return true;
	}

	function handleSubmit(send: (prompt: string) => void = (text) => onSend(text, launchOptions)): void {
		if (!canSend) return;
		const trimmed = prompt.trim();
		// Slash commands run as typed; attached context and comments wait for the next real prompt.
		const text = trimmed.startsWith("/")
			? trimmed
			: composePrompt(trimmed, takeContextChips(draftKey), takeQueuedDiffComments(draftKey));
		send(text);
		clearDraft();
	}
	// The send slot and chin are memoized, so they read the latest render's handlers through refs.
	const handleSubmitRef = useRef(handleSubmit);
	handleSubmitRef.current = handleSubmit;
	const submit = useCallback(() => handleSubmitRef.current(), []);

	const [discardId, setDiscardId] = useState<string | null>(null);
	const [historyWalk, setHistoryWalk] = useState<{
		draftKey: string;
		nav: HistoryNavigator;
	} | null>(null);
	const historyNav = historyWalk?.draftKey === draftKey ? historyWalk.nav : null;

	function showPrompt(text: string, caretAt: number) {
		pendingCaretRef.current = caretAt;
		setCaret(caretAt);
		setPrompt(text);
	}

	/** ↑/↓ walk prior prompts (caret on the first / last line); Esc restores the draft. */
	function handleHistoryKey(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
		if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return false;
		if (e.key === "Escape") {
			if (historyNav === null) return false;
			setHistoryWalk(null);
			showPrompt(historyNav.draft, historyNav.draft.length);
		} else {
			const {selectionStart, selectionEnd} = e.currentTarget;
			if (!historyKeyApplies(e.key, prompt, selectionStart, selectionEnd)) return false;
			const lastQueued = queue?.items.at(-1);
			if (e.key === "ArrowUp" && historyNav === null && prompt === "" && lastQueued) {
				editQueuedPrompt(lastQueued);
			} else {
				const from = historyNav ?? historyNavigator(promptHistory, prompt);
				const next = e.key === "ArrowUp" ? from.up() : from.down();
				if (next === null) return false;
				setHistoryWalk(next.active ? {draftKey, nav: next} : null);
				showPrompt(next.text, e.key === "ArrowUp" ? 0 : next.text.length);
			}
		}
		e.preventDefault();
		e.stopPropagation();
		return true;
	}

	function editQueuedPrompt(item: QueuedPrompt) {
		queue?.remove(item.id);
		const next = prompt.trim() === "" ? item.text : `${item.text}\n\n${prompt}`;
		pendingCaretRef.current = item.text.length;
		setCaret(item.text.length);
		setPrompt(next);
		textareaRef.current?.focus();
	}

	function attachFiles(files: readonly File[]) {
		setAttachError(null);
		for (const file of files) {
			uploadAttachment(file).then(
				(saved) => {
					const image = saved.mediaType.startsWith("image/");
					const previewUrl =
						image && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : undefined;
					attachContext(draftKey, {
						kind: image ? "image" : "file",
						path: saved.path,
						name: saved.name,
						...(previewUrl === undefined ? {} : {previewUrl}),
					});
				},
				(error: unknown) => {
					const reason = error instanceof Error ? error.message : String(error);
					setAttachError(`Couldn’t attach ${file.name}: ${reason}`);
				},
			);
		}
	}

	function handlePaste(e: React.ClipboardEvent) {
		const files = Array.from(e.clipboardData.files);
		if (files.length > 0) {
			e.preventDefault();
			attachFiles(files);
			return;
		}
		const text = e.clipboardData.getData("text/plain");
		if (isLongPaste(text)) {
			e.preventDefault();
			attachContext(draftKey, {kind: "pasted-text", text});
		}
	}

	const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

	const insertSlash = useCallback(() => {
		const current = promptRef.current;
		setPrompt(current.startsWith("/") ? current : `/${current}`);
		textareaRef.current?.focus();
	}, [setPrompt]);

	const closeDiscard = useCallback((open: boolean) => {
		if (!open) setDiscardId(null);
	}, []);
	const confirmDiscard = useCallback(() => {
		if (discardId !== null) queue?.remove(discardId);
	}, [discardId, queue]);

	const launchControls = useMemo<ChinLaunchControls>(
		() => ({
			launchOptions: chinLaunchOptions,
			onLaunchOptionsChange:
				live === undefined
					? (options) => setLaunch({draftKey, options})
					: (options) => void live.apply(options),
			confirmEffortChange: live !== undefined,
			openMenu,
			onOpenMenuChange: setOpenMenu,
			bypassPermissionsAllowed,
		}),
		[chinLaunchOptions, live, draftKey, openMenu, bypassPermissionsAllowed],
	);

	function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (e.nativeEvent.isComposing || handleSlashKey(e) || handleMentionKey(e) || handleHistoryKey(e)) {
			return;
		}
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			const commandChord = e.metaKey || e.ctrlKey;
			if (commandChord && e.altKey && onFork !== undefined) {
				handleSubmit((text) => onFork(text, chinLaunchOptions));
			} else if (commandChord && !e.altKey && onSendNow !== undefined) {
				handleSubmit(onSendNow);
			} else {
				handleSubmit();
			}
		}
	}

	return (
		<div data-cds="ChatComposer" data-focus-region="composer" className="flex w-full min-w-0 flex-col font-sans">
			{queue !== undefined && (
				<QueuedPromptChips
					items={queue.items}
					onEdit={editQueuedPrompt}
					onSendNow={queue.sendNow}
					onRemove={setDiscardId}
				/>
			)}
			<ConfirmDialog
				open={discardId !== null}
				onOpenChange={closeDiscard}
				title="Discard queued message?"
				body="This message will be removed from the queue and won’t be sent."
				confirmLabel="Discard"
				variant="danger"
				onConfirm={confirmDiscard}
			/>
			{attachError !== null && (
				<p role="alert" className="mb-1.5 ps-1 text-footnote text-danger-000">
					{attachError}
				</p>
			)}
			{(contextChips.length > 0 || queuedComments.length > 0) && (
				<AttachedContextChips sessionId={draftKey} context={contextChips} comments={queuedComments} />
			)}
			<input
				ref={fileInputRef}
				type="file"
				multiple
				accept="image/*,text/*"
				aria-label="Add files or photos"
				tabIndex={-1}
				className="hidden"
				onChange={(e) => {
					attachFiles(Array.from(e.target.files ?? []));
					e.target.value = "";
				}}
			/>
			<div
				data-composer-card
				className={CARD_CLASS}
				onClick={() => textareaRef.current?.focus()}
				onDragOver={(e) => {
					if (disabled || !hasFiles(e)) return;
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={(e) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
				}}
				onDrop={(e) => {
					if (disabled || !hasFiles(e)) return;
					e.preventDefault();
					setDragging(false);
					attachFiles(Array.from(e.dataTransfer.files));
				}}
			>
				{dragging && (
					<div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center rounded-card border border-dashed border-accent-100 bg-surface-3/90 text-footnote text-secondary">
						Drop files here
					</div>
				)}
				<div className="relative pr-[30px]">
					{slashOpen && query !== null && (
						<SlashCommandMenu
							id={slashMenuId}
							commands={matches}
							query={query}
							highlighted={highlighted}
							onHighlight={(index) => setHighlight({query, index})}
							onAccept={acceptSlashCommand}
						/>
					)}
					{mentionOpen && (
						<FileMentionMenu
							id={mentionMenuId}
							entries={mentionEntries}
							highlighted={mentionHighlighted}
							onHighlight={(index) => setMentionHighlight({entries: mentionEntries, index})}
							onAccept={acceptFileMention}
						/>
					)}
					{argumentHint !== null && (
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-y-0 right-[30px] left-0 overflow-hidden py-0.5 pl-1 font-sans text-[14px]/[20px] break-words whitespace-pre-wrap pointer-coarse:text-[16px]"
						>
							<span className="invisible">{prompt}</span>
							<span data-testid="slash-argument-hint" className="text-[rgb(137,135,129)]">
								{argumentHint}
							</span>
						</div>
					)}
					<textarea
						ref={textareaRef}
						aria-label="Prompt"
						data-focus-region-entry
						value={prompt}
						onChange={(e) => {
							setHistoryWalk(null);
							setCaret(e.target.selectionStart);
							setPrompt(e.target.value);
						}}
						onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
						onKeyDown={handleKeyDown}
						onPaste={handlePaste}
						aria-controls={slashOpen ? slashMenuId : mentionOpen ? mentionMenuId : undefined}
						aria-activedescendant={
							slashOpen
								? slashCommandOptionId(slashMenuId, highlighted)
								: mentionOpen
									? fileMentionOptionId(mentionMenuId, mentionHighlighted)
									: undefined
						}
						placeholder={PLACEHOLDER[variant]}
						disabled={isStreaming || disabled}
						rows={1}
						enterKeyHint="enter"
						className={EDITOR_CLASS}
						style={{minHeight: "24px", maxHeight: "min(24rem, 40svh)"}}
					/>
					<SendSlot
						isStreaming={isStreaming}
						onStop={onStop}
						onCancel={onCancel}
						onSubmit={submit}
						canSend={canSend}
						deliveryHint={deliveryHint}
						hintId={hintId}
						forkLabel={onFork === undefined ? undefined : forkLabel}
					/>
				</div>
			</div>
			<div
				data-cds="ChatComposerChin"
				className="mt-1.5 flex min-h-5 items-center justify-between ps-[7px] pe-2.5 text-[12px]/[15px] text-secondary"
			>
				{chin && (
					<ComposerChin
						state={chin}
						onInsertSlash={insertSlash}
						onAddFiles={openFilePicker}
						launch={launchControls}
					/>
				)}
			</div>
		</div>
	);
}
