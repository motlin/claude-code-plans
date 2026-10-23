import {
	memo,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {CircleStop, CornerDownLeft} from "lucide-react";

import {useBandEnter} from "../hooks/use-band-enter";
import {useComposerDraft} from "../hooks/use-composer-draft";
import {useFileMentionSuggestions} from "../hooks/use-file-mention-suggestions";
import type {LiveLaunchControls} from "../hooks/use-live-launch-options";
import {useIsMac} from "../hooks/use-is-mac";
import {useShortcut, useShortcutKeys} from "../hooks/use-shortcut";
import type {ComposerState} from "../lib/composer-state";
import {type QueuedPrompt, queuedForLater, queuedStatusText} from "../lib/composer-queue";
import {type HistoryNavigator, historyKeyApplies, historyNavigator} from "../lib/prompt-history";
import {
	appendAttachment,
	attachUploadedFiles,
	composePrompt,
	mergeTakeBack,
	registerComposer,
	takeContextChips,
	waitForPendingUploads,
	useContextChips,
} from "../lib/context-attach";
import {takeQueuedDiffComments, useDiffComments} from "../lib/diff-comments";
import type {SessionFilesEntry} from "../lib/api/session-files";
import {fileMentionTrigger, insertFileMention} from "../lib/file-mentions";
import type {LaunchOptions} from "../lib/launch-options";
import {filterSlashCommands, type SlashCommand, slashArgumentHint, slashTrigger} from "../lib/slash-commands";
import {type ChinLaunchControls, ComposerAddMenu, ComposerChin} from "./composer-chin";
import {AttachedContextChips} from "./attached-context-chips";
import type {ChinMenu} from "./composer-launch-menus";
import {
	COMPOSER_CARD_CLASS,
	COMPOSER_CHIN_CLASS,
	ENVIRONMENT_BAR_CLASS,
	ENVIRONMENT_BAR_ROW_CLASS,
	ENVIRONMENT_PLACE_CLASS,
} from "./composer-tokens";
import {FileMentionMenu} from "./file-mention-menu";
import {QueuedMessageBar} from "./queued-message-bar";
import {ToastContext} from "./toast-context";
import {fileMentionOptionId} from "./file-mention-option-id";
import {SlashCommandMenu} from "./slash-command-menu";
import {slashCommandOptionId} from "./slash-command-option-id";
import {Tooltip} from "./ui/tooltip";
import {startComposerKeystrokeJourney, startComposerSubmitJourneys} from "../lib/perf/field-journeys";
import {SESSION_COMPOSER_PLACEHOLDER} from "../lib/composer-pending-gate";
import {useCoarsePointer} from "../lib/use-phone-sheet";
import {type SplitItem, SplitDropdownButton} from "./ui/split-dropdown-button";

type ComposerVariant = "session" | "home";

const PLACEHOLDER: Record<ComposerVariant, string> = {
	session: SESSION_COMPOSER_PLACEHOLDER,
	home: "Describe a task or ask a question",
};

/** Upstream's placeholder while Claude works: `{sendKey} to send, {queueKey} to queue for later`. */
function workingPlaceholder(isMac: boolean): string {
	return `⏎ to send, ${isMac ? "⌘⏎" : "Ctrl⏎"} to queue for later`;
}

const EDITOR_CLASS =
	"block w-full resize-none overflow-y-auto bg-transparent py-1 pl-1 font-sans text-[14px]/[20px] text-primary [field-sizing:content] placeholder:text-[rgb(137,135,129)] focus:outline-none disabled:opacity-50";

/** Overlays ghost text after the prompt, lined up with the textarea's text (and its coarse-pointer floor). */
const GHOST_OVERLAY_CLASS =
	"pointer-events-none absolute inset-y-0 right-[30px] overflow-hidden py-1 pl-1 font-sans text-[14px]/[20px] break-words whitespace-pre-wrap text-entry-floored";

const ICON_BUTTON_CLASS =
	"flex aspect-square size-7 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40";

/** Prompts waiting for the live session to go idle, with their chip actions. */
export interface ComposerQueueView {
	items: readonly QueuedPrompt[];
	sendNow: (id: string) => Promise<void>;
	remove: (id: string) => void;
	clear: () => void;
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
	/**
	 * Home only: the place controls that lead upstream's environment bar, which
	 * replaces the chin row and wraps them onto their own row below 460px.
	 */
	environment?: ReactNode;
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
	/** ⌘⏎ "Queue for later": hold this prompt until the current turn ends instead of steering it. */
	onQueueForLater?: ((prompt: string) => void) | undefined;
	/** ⌥⌘⏎ "Fork with this prompt": send it to a new forked session instead of this one. */
	onFork?: ((prompt: string, launchOptions: LaunchOptions) => void) | undefined;
	/** ⌘⏎ "Send and stay here" on the home composer: launch the session without opening it. */
	onSendAndStay?: ((prompt: string, launchOptions: LaunchOptions) => void) | undefined;
	/** The Send tooltip's fork row: "Fork with this prompt" or "Send in a forked session". */
	forkLabel?: string | undefined;
	/** Prior prompts, newest first, that ↑/↓ walk like a shell history. */
	promptHistory?: readonly string[] | undefined;
	/** Subscribes to requests that replace the draft, focus it and put the caret at the end. */
	subscribePrefill?: ((listener: (text: string) => void) => () => void) | undefined;
}

/**
 * The card's trailing Send / Stop button. Memoized on stable props, so a keystroke re-renders it only when
 * `hasContent` or `canSend` flips. Like upstream's `code-prompt-send-cell`, an empty composer holds only an
 * invisible, inert spacer the size of the button, so Send appears with the first text without reflowing the box.
 */
const SEND_FACE_CLASS = "col-start-1 row-start-1 flex cursor-default items-center justify-end";
/** Upstream's incoming send-cell face (`Kd`): fades in after the outgoing one has started to leave. */
const SEND_FACE_ENTER_CLASS = "motion-safe:animate-[cds-fade-in_0.12s_ease-out_0.08s_backwards]";
/** Upstream's outgoing send-cell face (`qd`): fades out over 80ms, then turns invisible and unmounts. */
const SEND_FACE_EXIT_CLASS =
	"pointer-events-none invisible opacity-0 [transition:visibility_0s_linear_80ms] motion-safe:[transition:opacity_80ms_ease-out,visibility_0s_linear_80ms]";

type SendFace = "stop" | "send";

/** Upstream's `Ou`: a primary tap this soon after a Stop click is the same finger landing twice. */
const STOP_TAP_GUARD_MS = 500;
const noop = () => undefined;
/* The coarse spacer's inert split never opens, but its menu holds the working items so it measures the same. */
const SPACER_SPLIT_ITEMS: SplitItem[] = [
	{label: "Queue for later", onSelect: noop},
	{label: "Stop", separatorBefore: true, onSelect: noop},
];

/** Which lane a touch split submit goes to: Send (a steer while working) or the menu's Queue for later. */
type TouchSubmitLane = "send" | "later";

/**
 * Upstream's send-cell crossfade (`Jd`): Stop and Send share one grid cell. When the face flips, the new one
 * fades in while the old one stays mounted, `inert` and hidden, until its `visibility` transition ends.
 */
function SendCrossfade({showStop, stop, send}: {showStop: boolean; stop: ReactNode; send: ReactNode}) {
	const face: SendFace = showStop ? "stop" : "send";
	const [current, setCurrent] = useState<SendFace>(face);
	const [leaving, setLeaving] = useState<SendFace | null>(null);
	const [flipped, setFlipped] = useState(false);
	if (current !== face) {
		setCurrent(face);
		setLeaving(current);
		setFlipped(true);
	}
	function renderFace(name: SendFace, children: ReactNode) {
		if (name === face) {
			return (
				<div
					key={name}
					data-send-face
					className={flipped ? `${SEND_FACE_CLASS} ${SEND_FACE_ENTER_CLASS}` : SEND_FACE_CLASS}
				>
					{children}
				</div>
			);
		}
		if (name !== leaving) return null;
		return (
			<div
				key={name}
				data-send-face
				inert
				aria-hidden="true"
				className={`${SEND_FACE_CLASS} ${SEND_FACE_EXIT_CLASS}`}
				onTransitionEnd={(event) => {
					if (event.target === event.currentTarget && event.propertyName === "visibility") setLeaving(null);
				}}
			>
				{children}
			</div>
		);
	}
	return (
		<div className="grid items-center justify-items-end">
			{renderFace("stop", stop)}
			{renderFace("send", send)}
		</div>
	);
}

/**
 * The card's trailing Send / Stop button. Memoized on stable props, so a keystroke re-renders it only when
 * `hasContent` or `canSend` flips. Like upstream's `code-prompt-send-cell`, an empty idle composer holds only an
 * invisible, inert spacer the size of the button, so Send appears with the first text without reflowing the box.
 * While the session works, Stop holds the cell until there is a draft, then cross-fades to Send.
 */
const SendSlot = memo(function SendSlot({
	isStreaming,
	onStop,
	onCancel,
	onSubmit,
	hasContent,
	canSend,
	deliveryHint,
	hintId,
	forkLabel,
	sendAndStay,
	queueForLater,
	onTouchSubmit,
	editorRef,
}: {
	isStreaming: boolean;
	onStop: (() => void) | undefined;
	onCancel: (() => void) | undefined;
	/** Receives the Send click, so the send journey is timed from it. */
	onSubmit: (event: React.MouseEvent) => void;
	/** Whether there is anything to send; Send is hidden behind a spacer until there is. */
	hasContent: boolean;
	canSend: boolean;
	deliveryHint: string | undefined;
	hintId: string;
	/** The Send tooltip's fork row, when the composer can fork. */
	forkLabel: string | undefined;
	/** The Send tooltip's "Send and stay here" row, when the composer offers it. */
	sendAndStay: boolean;
	/** The working Send tooltip's "Queue for later" row, when ⌘⏎ queues. */
	queueForLater: boolean;
	/** The coarse-pointer split's primary Send and its "Queue for later" item. */
	onTouchSubmit: (lane: TouchSubmitLane) => void;
	/** The prompt editor, which takes focus back when the split's menu closes. */
	editorRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
	const coarse = useCoarsePointer();
	const stopClickAtRef = useRef(Number.NEGATIVE_INFINITY);
	const forkKeys = useShortcutKeys("fork_with_prompt").keys;
	const cmdEnterKeys = useIsMac() ? "cmd+enter" : "ctrl+enter";
	const working = isStreaming || onStop !== undefined;
	const forkRow = forkLabel === undefined ? undefined : {content: forkLabel, shortcut: forkKeys};
	const secondary = working
		? [
				...(queueForLater ? [{content: "Queue for later", shortcut: cmdEnterKeys}] : []),
				...(forkRow === undefined ? [] : [forkRow]),
			]
		: (forkRow ?? (sendAndStay ? {content: "Send and stay here", shortcut: cmdEnterKeys} : undefined));
	const send = (
		<Tooltip content="Send" shortcut="enter" secondary={secondary}>
			<button
				type="button"
				aria-label="Send"
				aria-describedby={deliveryHint ? hintId : undefined}
				data-testid="code-prompt-send"
				onClick={onSubmit}
				disabled={!canSend}
				className={ICON_BUTTON_CLASS}
			>
				<CornerDownLeft className="size-4" aria-hidden="true" />
			</button>
		</Tooltip>
	);
	const stop = () => {
		stopClickAtRef.current = Date.now();
		onStop?.();
	};
	/* Upstream leaves focus on the body after a menu Stop, so the soft keyboard stays down; other closes refocus the editor. */
	const stopFromMenuRef = useRef(false);
	const menuStop = () => {
		stopFromMenuRef.current = true;
		stop();
	};
	const splitFinalFocus = useCallback(() => {
		if (!stopFromMenuRef.current) return editorRef.current;
		stopFromMenuRef.current = false;
		return false;
	}, [editorRef]);
	/*
	 * Upstream's touch split (`ue = showStop && !R && isCoarsePointer`): working with a draft on a coarse
	 * pointer, the cell is a ghost split whose primary steers and whose menu queues or stops.
	 */
	const touchSplit = coarse && !isStreaming && onStop !== undefined && hasContent;
	const splitItems: SplitItem[] = queueForLater
		? [
				{
					label: "Queue for later",
					onSelect: () => {
						onTouchSubmit("later");
					},
				},
				{label: "Stop", separatorBefore: true, onSelect: menuStop},
			]
		: [{label: "Stop", onSelect: menuStop}];
	const face = touchSplit ? (
		<SplitDropdownButton
			variant="ghost"
			size="touch"
			icon={<CornerDownLeft className={`size-4${canSend ? "" : " opacity-40"}`} aria-hidden="true" />}
			aria-label="Send"
			aria-keyshortcuts="Enter"
			menuLabel="More send options"
			side="top"
			align="end"
			items={splitItems}
			finalFocus={splitFinalFocus}
			{...(canSend ? {} : {"aria-disabled": true})}
			onPrimaryClick={() => {
				if (!canSend || Date.now() - stopClickAtRef.current < STOP_TAP_GUARD_MS) return;
				onTouchSubmit("send");
			}}
		/>
	) : working ? (
		<SendCrossfade
			showStop={isStreaming || !hasContent}
			stop={
				<Tooltip content="Stop" {...(isStreaming ? {} : {shortcut: "escape"})}>
					<button
						type="button"
						aria-label="Stop"
						aria-keyshortcuts={isStreaming ? undefined : "Escape"}
						data-testid="code-prompt-stop"
						onClick={isStreaming ? onCancel : stop}
						className={ICON_BUTTON_CLASS}
					>
						<span className="flex scale-90">
							<CircleStop className="size-5" aria-hidden="true" />
						</span>
					</button>
				</Tooltip>
			}
			send={send}
		/>
	) : hasContent ? (
		send
	) : null;
	const hint = deliveryHint && (
		<span id={hintId} className="sr-only">
			{deliveryHint}
		</span>
	);
	/*
	 * Upstream's coarse send cell (`ku`/`Au`): an invisible, inert copy of the split always reserves its width,
	 * and the visible face overlays it end-aligned, so the box never reflows when the split appears.
	 */
	if (coarse) {
		return (
			<div className="absolute right-0 bottom-0 grid min-h-7 items-center justify-items-end pl-1.5">
				<div data-send-spacer aria-hidden="true" inert className="invisible col-start-1 row-start-1 flex">
					<SplitDropdownButton
						variant="ghost"
						size="touch"
						icon={<CornerDownLeft className="size-4" aria-hidden="true" />}
						aria-label="Send"
						menuLabel="More send options"
						items={SPACER_SPLIT_ITEMS}
						onPrimaryClick={noop}
					/>
				</div>
				{face !== null && (
					<div data-send-face-slot className="col-start-1 row-start-1 flex">
						{face}
					</div>
				)}
				{hint}
			</div>
		);
	}
	return (
		<div className="absolute right-0 bottom-0 flex min-h-7 items-center pl-1.5">
			{face ?? (
				<div data-send-spacer aria-hidden="true" inert className="invisible flex">
					<span className="size-7" />
				</div>
			)}
			{hint}
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
	environment,
	slashCommands = NO_COMMANDS,
	bypassPermissionsAllowed = false,
	live,
	mentionSessionId,
	queue,
	onQueueForLater,
	onFork,
	onSendAndStay,
	forkLabel = "Fork with this prompt",
	promptHistory = NO_HISTORY,
	subscribePrefill,
}: ComposerProps) {
	const {text: prompt, setText: setPrompt, clear: clearDraft} = useComposerDraft(draftKey);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	// Optional: composers rendered outside the app shell (tests, previews) have no toaster.
	const toast = useContext(ToastContext);
	const hintId = useId();
	const isMac = useIsMac();
	const slashMenuId = useId();
	const mentionMenuId = useId();
	const [caret, setCaret] = useState(0);
	const pendingCaretRef = useRef<number | null>(null);
	const {queued: queuedComments} = useDiffComments(draftKey);
	const contextChips = useContextChips(draftKey);
	const hasContent = prompt.trim() !== "" || queuedComments.length > 0 || contextChips.length > 0;
	const canSend = hasContent && !isStreaming && !disabled;
	const [launch, setLaunch] = useState<{draftKey: string; options: LaunchOptions}>({
		draftKey,
		options: {},
	});
	const launchOptions = launch.draftKey === draftKey ? launch.options : NO_LAUNCH_OPTIONS;
	const [openMenu, setOpenMenu] = useState<ChinMenu | null>(null);
	const menuShortcutOptions = {disabled: chin === undefined};
	useShortcut(
		"open_mode_menu",
		() => {
			setOpenMenu("mode");
		},
		menuShortcutOptions,
	);
	useShortcut(
		"open_model_menu",
		() => {
			setOpenMenu("model");
		},
		menuShortcutOptions,
	);
	useShortcut(
		"open_effort_selector",
		() => {
			setOpenMenu("effort");
		},
		menuShortcutOptions,
	);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);
	useShortcut("add_files", openFilePicker, {disabled});
	const chinLaunchOptions = live?.options ?? launchOptions;

	useEffect(() => {
		if (!isStreaming) textareaRef.current?.focus();
	}, [isStreaming]);

	const promptRef = useRef(prompt);
	promptRef.current = prompt;
	const draftKeyRef = useRef(draftKey);
	draftKeyRef.current = draftKey;
	const waitingSendRef = useRef(false);
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
				takeBack: (text) => {
					const next = mergeTakeBack(text, promptRef.current);
					promptRef.current = next;
					pendingCaretRef.current = text.length;
					setCaret(text.length);
					setPrompt(next);
					textareaRef.current?.focus();
				},
			}),
		[draftKey, setPrompt],
	);

	useEffect(
		() =>
			subscribePrefill?.((text) => {
				const textarea = textareaRef.current;
				textarea?.focus();
				// An unchanged prompt skips the caret layout effect, so place the caret now.
				if (promptRef.current === text) textarea?.setSelectionRange(text.length, text.length);
				else pendingCaretRef.current = text.length;
				promptRef.current = text;
				setCaret(text.length);
				setPrompt(text);
			}),
		[subscribePrefill, setPrompt],
	);

	const slash = slashTrigger(prompt, caret);
	const query = slash?.query ?? null;
	// Esc dismisses the whole `/` trigger, as upstream does: typing more keeps it closed until the token is gone.
	const [slashDismissed, setSlashDismissed] = useState(false);
	if (slashDismissed && slash === null) setSlashDismissed(false);
	const slashKey = slash === null ? null : `${slash.start}\0${slash.query}`;
	const [highlight, setHighlight] = useState<{key: string | null; index: number}>({key: null, index: 0});
	const matches = slash === null || slashDismissed ? [] : filterSlashCommands(slashCommands, slash.query);
	const slashOpen = matches.length > 0;
	// A mid-line slash opens with nothing highlighted (-1), as upstream's `startsUnselected` does.
	const highlighted =
		highlight.key === slashKey ? Math.min(highlight.index, matches.length - 1) : slash?.atStart === true ? 0 : -1;
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
		if (slash === null) return;
		const inserted = `/${command.name} `;
		const next = slash.start + inserted.length;
		pendingCaretRef.current = next;
		setCaret(next);
		setPrompt(prompt.slice(0, slash.start) + inserted + prompt.slice(caret));
		textareaRef.current?.focus();
	}

	function handleSlashKey(e: React.KeyboardEvent): boolean {
		if (!slashOpen) return false;
		const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
		if (move !== 0) {
			const index =
				highlighted === -1
					? move === 1
						? 0
						: matches.length - 1
					: Math.max(0, Math.min(matches.length - 1, highlighted + move));
			setHighlight({key: slashKey, index});
		} else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
			const command = matches[highlighted];
			// Nothing highlighted: upstream closes the menu and lets the key through (Enter sends).
			if (command === undefined) {
				setSlashDismissed(true);
				return false;
			}
			acceptSlashCommand(command);
		} else if (e.key === "Escape") {
			setSlashDismissed(true);
			e.stopPropagation();
		} else {
			return false;
		}
		e.preventDefault();
		return true;
	}

	function handleSubmit(
		send: (prompt: string) => void = (text) => {
			onSend(text, launchOptions);
		},
		trigger?: Event,
	): void {
		if (!canSend) return;
		// The session composer's draft is keyed by its session id.
		if (trigger !== undefined && variant === "session") startComposerSubmitJourneys(trigger, draftKey);
		const trimmed = prompt.trim();
		// Slash commands run as typed; attached context and comments wait for the next real prompt.
		if (trimmed.startsWith("/")) {
			send(trimmed);
			clearDraft();
			return;
		}
		const finish = () => {
			send(composePrompt(trimmed, takeContextChips(draftKey), takeQueuedDiffComments(draftKey)));
			clearDraft();
		};
		if (!contextChips.some((chip) => chip.status === "pending")) {
			finish();
			return;
		}
		// Upstream's waitForImagesReady: hold the send until uploads settle, and drop it
		// if the prompt or session changed meanwhile. A failed upload's chip is gone by then.
		if (waitingSendRef.current) return;
		waitingSendRef.current = true;
		void waitForPendingUploads(draftKey).then(() => {
			waitingSendRef.current = false;
			if (draftKeyRef.current !== draftKey || promptRef.current !== prompt) return;
			finish();
		});
	}
	// The send slot and chin are memoized, so they read the latest render's handlers through refs.
	const handleSubmitRef = useRef(handleSubmit);
	handleSubmitRef.current = handleSubmit;
	const submit = useCallback((event: React.MouseEvent) => {
		handleSubmitRef.current(undefined, event.nativeEvent);
	}, []);
	const onQueueForLaterRef = useRef(onQueueForLater);
	onQueueForLaterRef.current = onQueueForLater;
	const touchSubmit = useCallback((lane: TouchSubmitLane) => {
		const later = onQueueForLaterRef.current;
		if (lane === "later" && later !== undefined) handleSubmitRef.current(later);
		else handleSubmitRef.current();
	}, []);

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
		// Upstream refuses to pull a queued message back over a draft rather than merging them.
		if (prompt.trim() !== "") {
			toast?.({
				kind: "warning",
				message: "The input already has a draft. Clear it to pull this message back in.",
			});
			return;
		}
		queue?.remove(item.id);
		pendingCaretRef.current = item.text.length;
		setCaret(item.text.length);
		setPrompt(item.text);
		textareaRef.current?.focus();
	}

	function attachFiles(files: readonly File[]) {
		// Upstream refuses attachments until the session's meta has loaded; locally that's the launch window.
		if (disabled) {
			toast?.({
				kind: "error",
				message: "Files can’t be attached until the session finishes loading. Try again in a moment.",
			});
			return;
		}
		attachUploadedFiles(draftKey, files, (options) => toast?.(options));
	}

	function handlePaste(e: React.ClipboardEvent) {
		const files = Array.from(e.clipboardData.files);
		if (files.length > 0) {
			e.preventDefault();
			attachFiles(files);
			return;
		}
	}

	const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

	const insertSlash = useCallback(() => {
		const current = promptRef.current;
		// Upstream prepends "/" and leaves the caret right after it.
		pendingCaretRef.current = 1;
		setCaret(1);
		setPrompt(current.startsWith("/") ? current : `/${current}`);
		textareaRef.current?.focus();
	}, [setPrompt]);

	const queueBandSlot = useBandEnter<HTMLDivElement>();

	// Steers draw as waiting rows in the transcript; the band lists only prompts queued for later.
	const queuedItems = queue?.items;
	const laterItems = useMemo(() => queuedForLater(queuedItems ?? []), [queuedItems]);
	const launchControls = useMemo<ChinLaunchControls>(
		() => ({
			launchOptions: chinLaunchOptions,
			onLaunchOptionsChange:
				live === undefined
					? (options) => {
							setLaunch({draftKey, options});
						}
					: (options) => void live.apply(options),
			confirmEffortChange: live !== undefined,
			openMenu,
			onOpenMenuChange: setOpenMenu,
			bypassPermissionsAllowed,
		}),
		[chinLaunchOptions, live, draftKey, openMenu, bypassPermissionsAllowed],
	);

	function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		startComposerKeystrokeJourney(e.nativeEvent);
		if (e.nativeEvent.isComposing || handleSlashKey(e) || handleMentionKey(e) || handleHistoryKey(e)) {
			return;
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			const commandChord = e.metaKey || e.ctrlKey;
			// Upstream swallows ⌘⏎ key repeat so a held chord never sends twice.
			if (commandChord && e.repeat) {
				e.stopPropagation();
				return;
			}
			const trigger = e.nativeEvent;
			if (commandChord && e.altKey && onFork !== undefined) {
				handleSubmit((text) => {
					onFork(text, chinLaunchOptions);
				}, trigger);
			} else if (commandChord && !e.altKey && onQueueForLater !== undefined) {
				handleSubmit(onQueueForLater, trigger);
			} else if (commandChord && !e.altKey && onSendAndStay !== undefined) {
				handleSubmit((text) => {
					onSendAndStay(text, chinLaunchOptions);
				}, trigger);
			} else {
				handleSubmit(undefined, trigger);
			}
		}
	}

	return (
		<div data-cds="ChatComposer" data-focus-region="composer" className="flex w-full min-w-0 flex-col font-sans">
			{queue !== undefined && (
				<>
					<p aria-live="polite" aria-atomic="true" data-testid="coach-queued-status" className="sr-only">
						{laterItems.length > 0 ? queuedStatusText(laterItems.length) : ""}
					</p>
					{/* Upstream's QueuedMessageBar band sits in the dock, 6px above the composer card */}
					<div ref={queueBandSlot} className="mb-1.5 empty:hidden">
						<QueuedMessageBar
							sessionId={draftKey}
							items={laterItems}
							onEdit={editQueuedPrompt}
							onSendNow={queue.sendNow}
							onRemove={queue.remove}
							onClearAll={queue.clear}
						/>
					</div>
				</>
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
			{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a pointer shortcut that focuses the textarea, which is keyboard-reachable itself */}
			<div
				data-composer-card
				className={COMPOSER_CARD_CLASS}
				onClick={() => textareaRef.current?.focus()}
				onDragOver={(e) => {
					if (!hasFiles(e)) return;
					// Accept the drag even while launching so the drop lands here and toasts instead of opening the file.
					e.preventDefault();
					if (!disabled) setDragging(true);
				}}
				onDragLeave={(e) => {
					if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)))
						setDragging(false);
				}}
				onDrop={(e) => {
					if (!hasFiles(e)) return;
					e.preventDefault();
					setDragging(false);
					attachFiles(Array.from(e.dataTransfer.files));
				}}
			>
				{dragging && (
					<div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center rounded-composer border border-dashed border-accent-100 bg-surface-3/90 text-footnote text-secondary">
						Drop files here
					</div>
				)}
				{(contextChips.length > 0 || queuedComments.length > 0) && (
					<AttachedContextChips sessionId={draftKey} context={contextChips} comments={queuedComments} />
				)}
				<div className={`relative pr-[30px] pointer-coarse:pr-[51px] ${chin ? "pl-[30px]" : ""}`}>
					{chin && (
						<div data-composer-add="" className="absolute left-0 bottom-0 flex min-h-7 items-center">
							<ComposerAddMenu onInsertSlash={insertSlash} onAddFiles={openFilePicker} />
						</div>
					)}
					{slashOpen && (
						<SlashCommandMenu
							id={slashMenuId}
							commands={matches}
							query={query ?? ""}
							highlighted={highlighted}
							onHighlight={(index) => {
								setHighlight({key: slashKey, index});
							}}
							onAccept={acceptSlashCommand}
						/>
					)}
					{mentionOpen && (
						<FileMentionMenu
							id={mentionMenuId}
							entries={mentionEntries}
							highlighted={mentionHighlighted}
							onHighlight={(index) => {
								setMentionHighlight({entries: mentionEntries, index});
							}}
							onAccept={acceptFileMention}
						/>
					)}
					{argumentHint !== null && (
						<div aria-hidden="true" className={`${GHOST_OVERLAY_CLASS} ${chin ? "left-[30px]" : "left-0"}`}>
							<span className="invisible">{prompt}</span>
							<span data-testid="slash-argument-hint" className="text-[rgb(137,135,129)]">
								{argumentHint}
							</span>
						</div>
					)}
					{slashOpen && query === "" && (
						<div aria-hidden="true" className={`${GHOST_OVERLAY_CLASS} ${chin ? "left-[30px]" : "left-0"}`}>
							<span className="invisible">{prompt}</span>
							<span
								data-testid="slash-filter-placeholder"
								className="ml-0.5 text-ink-muted/75 select-none"
							>
								Type to filter
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
						onSelect={(e) => {
							setCaret(e.currentTarget.selectionStart);
						}}
						onKeyDown={handleKeyDown}
						onPaste={handlePaste}
						aria-controls={slashOpen ? slashMenuId : mentionOpen ? mentionMenuId : undefined}
						aria-activedescendant={
							slashOpen
								? highlighted === -1
									? undefined
									: slashCommandOptionId(slashMenuId, highlighted)
								: mentionOpen
									? fileMentionOptionId(mentionMenuId, mentionHighlighted)
									: undefined
						}
						placeholder={
							onStop !== undefined && onQueueForLater !== undefined
								? workingPlaceholder(isMac)
								: PLACEHOLDER[variant]
						}
						disabled={isStreaming || disabled}
						rows={1}
						enterKeyHint="enter"
						className={EDITOR_CLASS}
						style={{minHeight: "28px", maxHeight: "min(24rem, 40svh)"}}
					/>
					<SendSlot
						isStreaming={isStreaming}
						onStop={onStop}
						onCancel={onCancel}
						onSubmit={submit}
						hasContent={hasContent}
						canSend={canSend}
						deliveryHint={deliveryHint}
						hintId={hintId}
						forkLabel={onFork === undefined ? undefined : forkLabel}
						sendAndStay={onSendAndStay !== undefined}
						queueForLater={onQueueForLater !== undefined}
						onTouchSubmit={touchSubmit}
						editorRef={textareaRef}
					/>
				</div>
			</div>
			{environment === undefined ? (
				<div data-cds="ChatComposerChin" className={COMPOSER_CHIN_CLASS}>
					{chin && <ComposerChin state={chin} launch={launchControls} surface="chin" />}
				</div>
			) : (
				<div data-testid="epitaxy-environment-bar" className={ENVIRONMENT_BAR_CLASS}>
					<div data-testid="environment-bar-row" className={ENVIRONMENT_BAR_ROW_CLASS}>
						<div className={ENVIRONMENT_PLACE_CLASS}>{environment}</div>
						{chin && <ComposerChin state={chin} launch={launchControls} surface="bar" />}
					</div>
				</div>
			)}
		</div>
	);
}
