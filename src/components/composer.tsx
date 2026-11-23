import
{
	cloneElement,
	type CSSProperties,
	Fragment,
	memo,
	type ReactElement,
	type ReactNode,
	type Ref,
	useCallback,
	useContext,
	useEffect,
	useEffectEvent,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {ThemedToken} from "@shikijs/core";

import {useBandEnter} from "../hooks/use-band-enter";
import {useComposerDraft} from "../hooks/use-composer-draft";
import {type FileMentionSource, useFileMentionSuggestions} from "../hooks/use-file-mention-suggestions";
import {typedEmoticon} from "../lib/emoji-emoticons";
import {type EmojiItem, searchEmoji, warmEmoji} from "../lib/emoji-search";
import {emojiTrigger} from "../lib/emoji-trigger";
import {useMentionProviders} from "../hooks/use-mention-providers";
import type {MentionOutputFile} from "../lib/session-outputs";
import type {AgentTileProps} from "./agent-tile";
import
{
	fileMentionOption,
	type MentionOption,
	type MentionPendingBlock,
	type MentionProvider,
	mentionMenuWidth,
	mergeProviderOptions,
} from "../lib/mention-options";
import type {LiveLaunchControls} from "../hooks/use-live-launch-options";
import {useIsMac, useIsWindows} from "../hooks/use-is-mac";
import {useShortcut, useShortcutKeys} from "../hooks/use-shortcut";
import {useTypeToFocus} from "../hooks/use-type-to-focus";
import {isBareAdvisorCommand} from "../lib/advisor";
import type {OutputStyleItem} from "../lib/output-style-options";
import {assertNever} from "../lib/assert-never";
import type {ComposerState} from "../lib/composer-state";
import {type QueuedPrompt, parkedPrompts, queuedForLater, queuedStatusText} from "../lib/composer-queue";
import {consentWorkspaceKey} from "../lib/permission-mode-consent";
import {carryPickToFolder, folderModeKey} from "../lib/folder-permission-mode";
import {type HistoryNavigator, historyKeyApplies, historyNavigator} from "../lib/prompt-history";
import
{
	appendAttachment,
	attachUploadedFiles,
	BASH_MODE_REFUSAL,
	composePrompt,
	joinPrefill,
	mergeTakeBack,
	hydrateStagedChips,
	recordSentAttachments,
	registerComposer,
	prefillEmptyVerdict,
	type PrefillResult,
	takeContextChips,
	waitForPendingUploads,
	useContextChips,
	useRestoredChipIds,
} from "../lib/context-attach";
import {takeQueuedDiffComments, useDiffComments} from "../lib/diff-comments";
import {splitDroppedItems} from "../lib/drop-items";
import
{
	fileMentionMenuPosition,
	fileMentionTrigger,
	insertFileMention,
	isMentionSuppressed,
} from "../lib/file-mentions";
import {textareaCaretRect} from "../lib/textarea-caret";
import
{
	type AcceptedMention,
	mentionAt,
	mentionEndingAt,
	mentionStartingAt,
	remapMentions,
} from "../lib/composer-mentions";
import
{
	autocompactCommand,
	extraLinesBody,
	FAST_COMMAND_NOTICE_KEY,
	fastCommandArg,
	isMcpCommand,
	isMemoryCommand,
	parseCommandShape,
	parseHostCommand,
	parseOutputStyleCommand,
	parseSignInCommand,
	PLAN_COMMAND_NOTICE_KEY,
	PLAN_COMMAND_UNAVAILABLE_KEY,
	planCommandArg,
	routeFastCommand,
	routePlanCommand,
	routeSkillsCommand,
	routeStatusCommand,
	routeUsageCommand,
	SIGN_IN_COMMAND_KEY,
	trailingArgsBody,
} from "../lib/composer-host-commands";
import
{
	CLI_DEFAULT_MODEL,
	effortLevelsFor,
	type LaunchOptions,
	LaunchOptionsSchema,
	type LaunchPermissionMode,
	MORE_MODELS,
	modelLabel,
	PRIMARY_MODELS,
	type ModeBadgeSettings,
} from "../lib/launch-options";
import
{
	clampSlashHighlight,
	filterSlashCommands,
	firstSlashHighlight,
	isKnownSlashCommand,
	type SlashCommand,
	type SlashMenuItem,
	slashCommandRowKey,
	stepSlashHighlight,
	skillChipArgumentHint,
	slashMatcherCandidate,
	slashTrigger,
} from "../lib/slash-commands";
import
{
	buildCompactSlashMenu,
	COMPACT_SLASH_MENU_HOST,
	COMPACT_SLASH_MENU_LABELS,
	compactSlashHostRows,
	NO_MATCH_LABEL,
	type SlashEnvironment,
	type SlashRemoteControl,
	SUBMENU_OPEN_DELAY_MS,
} from "../lib/slash-compact-menu";
import {recordSlashUsage, SLASH_USAGE_ACCOUNT, slashUsageScores} from "../lib/slash-usage";
import {nearestCommand} from "../lib/command-suggest";
import {useBackgroundTasksOpener} from "./background-tasks-opener-context";
import {ComposerCommandNotice} from "./composer-command-notice";
import {type ChinLaunchControls, type ChinPickHandle, ComposerAddMenu, ComposerChin} from "./composer-chin";
import {ComposerChinFrame} from "./composer-chin-frame";
import {EnvironmentBarIconOnlyContext, useEnvironmentBarIconOnly} from "./use-environment-bar-icon-only";
import type {UsageRingContext} from "./usage-popover-context";
import {ErrorCardShell} from "./error-card-shell";
import type {ChinMenu} from "./composer-launch-menus";
import type {TryAutoCoachOffer} from "../lib/try-auto-coach";
import
{
	COMPOSER_CARD_CLASS,
	COMPOSER_EDITOR_ROW_CLASS,
	ENVIRONMENT_BAR_CHIPS_CLASS,
	ENVIRONMENT_BAR_CLASS,
	ENVIRONMENT_BAR_PLACE_SLOT_CLASS,
	ENVIRONMENT_BAR_ROW_CLASS,
	ENVIRONMENT_BAR_WORKTREE_SLOT_CLASS,
} from "./composer-tokens";
import {preloadFileTypeIcons} from "./file-type-icons-loader";
import {ToastContext} from "./toast-context";
import {fileMentionOptionId, mentionPopupId} from "./file-mention-option-id";
import {emojiOptionId} from "./emoji-option-id";
import {preloadComposerSurfaces, useComposerSurfaces} from "./composer-surfaces-entry";
import {slashCommandOptionId, slashSubmenuOptionId} from "./slash-command-option-id";
import {Icon} from "./ui/icon";
import {Spinner} from "./ui/spinner";
import {Tooltip} from "./ui/tooltip";
import {startComposerKeystrokeJourney, startComposerSubmitJourneys} from "../lib/perf/field-journeys";
import {SESSION_COMPOSER_PLACEHOLDER} from "../lib/composer-pending-gate";
import
{
	HIDDEN_CHARACTERS_REFUSAL,
	hasHiddenCharacters,
	isShellCommandText,
	shellCommandUnavailableMessage,
} from "../lib/composer-shell-command";
import {useCoarsePointer, usePhoneSheet} from "../lib/use-phone-sheet";
import {type PaneHostApi, useOptionalPaneHost} from "./panes/pane-host-context";
import {focusHeldByField, focusHeldByOverlay, isCoarsePointer, refocusEmptiedEditor} from "../lib/editor-refocus-guard";
import {handoffTarget, pickUpHandoff, useFaceFocusHandoff} from "../lib/face-focus-handoff";
import {showsWorkingPlaceholder, workingPlaceholders} from "../lib/working-placeholder";
import {useBashHighlight} from "../hooks/use-bash-highlight";
import {useIsOverflowing} from "../hooks/use-is-overflowing";
import {type SplitItem, SplitDropdownButton} from "./ui/split-dropdown-button";
import {useFileDropTarget} from "./composer-drop-scrim";
import {ChatFileDropContext} from "./chat-file-drop-context";
import {ComposerSkillChip} from "./composer-skill-chip";
import {type MentionChipActions, paintMentions} from "./composer-mention-paint";

type ComposerVariant = "session" | "home";

const PLACEHOLDER: Record<ComposerVariant, string> =
{
	session: SESSION_COMPOSER_PLACEHOLDER,
	home: "Describe a task or ask a question",
};

/**
 * The prompt follows Transcript text size via `--prompt-text-size` / `--prompt-line-height`
 * (upstream's `--cmp-font-size` / `--cmp-line-height`); inside a comfortable scope it reads the comfortable pair,
 * which fizzy-lake `type` drops to the comfortable prose scale (15/21 at Medium). The `--upstream-*-body` overrides
 * keep the coarse-pointer text-entry floor (globals.css) on the prompt size too. The floor's 22px line
 * takes 3px padding on coarse pointers so the editor box stays upstream's h28, as 20px + py-1 does on fine.
 */
const EDITOR_CLASS =
	"block w-full resize-none overflow-y-auto bg-transparent py-1 pl-1 pointer-coarse:py-[3px] font-sans comfortable:[--prompt-text-size:var(--prompt-comfortable-text-size)] comfortable:[--prompt-line-height:var(--prompt-comfortable-line-height)] text-[length:var(--prompt-text-size,14px)] leading-[var(--prompt-line-height,20px)] [--upstream-text-body:var(--prompt-text-size,14px)] [--upstream-leading-body:var(--prompt-line-height,20px)] [field-sizing:content] focus:outline-none disabled:opacity-50";

/** Overlays ghost text after the prompt, lined up with the textarea's text (and its coarse-pointer floor). */
const GHOST_OVERLAY_CLASS =
	"pointer-events-none absolute inset-y-0 right-[30px] comfortable:right-[32px] overflow-hidden py-1 pl-1 pointer-coarse:py-[3px] font-sans comfortable:[--prompt-text-size:var(--prompt-comfortable-text-size)] comfortable:[--prompt-line-height:var(--prompt-comfortable-line-height)] text-[length:var(--prompt-text-size,14px)] leading-[var(--prompt-line-height,20px)] [--upstream-text-body:var(--prompt-text-size,14px)] [--upstream-leading-body:var(--prompt-line-height,20px)] break-words whitespace-pre-wrap text-entry-floored";

/** Paints the whole prompt over a transparent textarea, so it also follows the coarse-pointer send gutter. */
const PAINTED_OVERLAY_CLASS = `${GHOST_OVERLAY_CLASS} left-[30px] comfortable:left-[32px] pointer-coarse:right-[51px] comfortable:pointer-coarse:right-[53px]`;

/**
 * Upstream's composer placeholder (shared-9 `absolute inset-0 pointer-events-none overflow-hidden`): an overlay,
 * not a native `placeholder`, so the 16px coarse-pointer text never wraps into `[field-sizing:content]` and grows
 * the empty editor past h28. The second line of a too-wide placeholder is clipped.
 */
const PLACEHOLDER_OVERLAY_CLASS = `${PAINTED_OVERLAY_CLASS} text-placeholder select-none`;

/**
 * Upstream's `placeholderFit` "clamp" (`truncate`): outside bash mode the single-row card keeps the placeholder on
 * one line with an ellipsis. Bash mode is "grow" and keeps the wrapping overlay.
 */
const PLACEHOLDER_CLAMP_CLASS = PLACEHOLDER_OVERLAY_CLASS.replace("break-words whitespace-pre-wrap", "truncate");

/** Upstream `.epitaxy-prompt[data-bash-mode]`: the editor, placeholder, probe and painted command take the mono face. */
function bashFont(className: string, bashMode: boolean): string
{
	return bashMode ? className.replace("font-sans", "font-mono") : className;
}

/** Upstream's inline visually-hidden style for the argument hint's live twin. */
const SR_ONLY_STYLE: CSSProperties =
{
	position: "absolute",
	top: 0,
	left: 0,
	width: "1px",
	height: "1px",
	overflow: "hidden",
	// oxlint-disable-next-line typescript/no-deprecated -- upstream's exact style keeps `clip` beside `clip-path` for older engines
	clip: "rect(0 0 0 0)",
	clipPath: "inset(50%)",
	whiteSpace: "nowrap",
};

/** An accepted slash command, drawn as upstream's chip until the prompt stops starting with it. */
interface AcceptedSkillChip
{
	draftKey: string;
	name: string;
	argumentHint: string | undefined;
	/** Upstream's chip `slashRouting`: "cli" only for an explicitly picked Custom command twin. */
	routing: "cli" | null;
}

/** Upstream's `cliCommandForced`: the leading chip was a Custom command twin, so the CLI runs the command. */
interface SlashRouting
{
	cliCommandForced: true;
}

const ICON_BUTTON_CLASS =
	"flex aspect-square size-7 items-center justify-center rounded-r5 comfortable:rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40";

/** Prompts waiting for the live session to go idle, with their chip actions. */
export interface ComposerQueueView
{
	items: readonly QueuedPrompt[];
	/** Prompts whose Send now was accepted; each shows upstream's ✓ Sent chip. */
	acceptedIds?: ReadonlySet<string>;
	sendNow: (id: string) => Promise<void>;
	remove: (id: string) => void;
	clear: () => void;
	/** Drag reorder of later prompts; absent, the expanded band has no handles. */
	reorder?: ((id: string, overId: string) => void) | undefined;
	/** The parked lane's state; its prompts are the queue's parked items. */
	parked?: ComposerParkedView | undefined;
}

/** Upstream's parked-bar props (`cj`): what the held prompts will do and Send anyway. */
export interface ComposerParkedView
{
	willAutoSend: boolean;
	/** Epoch seconds. */
	resetsAt: number | undefined;
	archived: boolean;
	flushing: boolean;
	sendAnyway: () => void;
	/** Upstream's `listInTranscript`: the held prompts draw as transcript rows and the limit band, not the dock bar. */
	listInTranscript: boolean;
}

/**
 * Upstream's `/rewind` gate (`dn`) plus its unsupported check: `unsupported` (can't rewind at all),
 * `offline` (upstream's `bridgeOffline`; locally no writable live pane), `busy` (`ignore`) or `ready`.
 */
export type ComposerRewindState = "unsupported" | "offline" | "busy" | "ready";

interface ComposerRewind
{
	state: ComposerRewindState;
	/** Opens the Rewind picker, after the composer has cleared `/rewind`. */
	open: () => void;
}

interface ComposerStatusCommand
{
	/** A turn is running, so the card waits (upstream's `jj(bucket)`). */
	turnActive: boolean;
	/** Appends the user row and Session info card for the command as sent. */
	show: (text: string) => void;
}

interface ComposerUsageCommand
{
	/** A turn is running, so Settings › Usage opens instead (upstream's `jj(bucket)`). */
	turnActive: boolean;
	/** Appends the user row and Usage card for the command as sent; null on the home composer. */
	show: ((text: string) => void) | null;
	/** Opens Settings › Usage. */
	openSettings: () => void;
}

/**
 * Upstream's `nestedStop` send-cell prop (`Jbe`): an idle, empty composer offers to stop work that outlives
 * the turn. Locally that is the CLI's background agents and workflows.
 */
export interface NestedStopFace
{
	label: string;
	stopping: boolean;
	stoppingLabel: string;
	onStop: () => void;
}

interface ComposerProps
{
	variant: ComposerVariant;
	/** Draft storage key: the session id, or `"home"` for the new-session composer. */
	draftKey: string;
	/** `launchOptions` holds the chin's mode / model / effort picks for a fork or launch. */
	onSend: (prompt: string, launchOptions: LaunchOptions, routing?: SlashRouting) => void;
	onCancel?: () => void;
	isStreaming?: boolean;
	/** While a live session is working, the send slot becomes Stop response. */
	onStop?: (() => void) | undefined;
	/** While idle and empty, the send slot offers to stop the session's background agents. */
	nestedStop?: NestedStopFace | undefined;
	/** When the host last asked this turn to stop (Stop, its menu, or Esc), so a keyboard Stop hands focus back. */
	stopAskedAt?: number | null;
	disabled?: boolean;
	/**
	 * Where dropped files land: upstream's page-wide hook and scrim (the home composer), or the chat tile's drop zone
	 * (the session composer registers its attach through ChatFileDropContext).
	 */
	dropScope?: "page" | "chat-panel";
	deliveryHint?: string | undefined;
	/** Mode / model / effort / usage readouts; the chin stays empty without them. */
	chin?: ComposerState | undefined;
	/** The session's context breakdown and compact action for the usage ring's context-mode popover. */
	usageContext?: UsageRingContext | undefined;
	/**
	 * Home only: the place controls that lead upstream's environment bar, which
	 * replaces the chin row and wraps them onto their own row below 460px.
	 */
	environment?: ReactNode;
	/** Home only: upstream's Worktree toggle chip, in its own slot after the place. */
	worktreeToggle?: ReactNode;
	/** Entries for the "/" autocomplete popup (`GET /api/commands`). */
	slashCommands?: readonly SlashCommand[] | undefined;
	/** Upstream's explanatory section header drawn above the "/" rows, e.g. when the command list didn't load. */
	slashMenuHeader?: string | undefined;
	/** The "/" list is still loading: the menu shows upstream's single skeleton row instead of commands. */
	slashCommandsLoading?: boolean | undefined;
	/** Called each time a "/" trigger opens the menu, so a failed command list can retry. */
	onSlashMenuOpen?: (() => void) | undefined;
	/** Upstream's `compactSlashMenuHost` gate: the grouped "/" menu with host rows (defaults to `COMPACT_SLASH_MENU_HOST`). */
	compactSlashMenu?: boolean | undefined;
	/** The grouped menu's Remote Control row; omitted (null) when the session has no live pane to toggle it in. */
	slashRemoteControl?: SlashRemoteControl | null | undefined;
	/** The home draft's grouped-menu Environment row. */
	slashEnvironment?: SlashEnvironment | undefined;
	/** Settings allow launching in Bypass permissions mode. */
	bypassPermissionsAllowed?: boolean | undefined;
	/** What the Mode menu's Default / Recommended badges read. */
	modeBadges?: ModeBadgeSettings | undefined;
	/** The home draft's Auto lock for its picked model (`ChinLaunchControls.autoLockNote`). */
	autoLockNote?: string | null | undefined;
	/** The session's or chosen folder's working directory, which a Bypass consent and mode pick are remembered for. */
	permissionCwd?: string | undefined;
	/** A Mode menu pick, remembered for `permissionCwd`'s folder (upstream's per-folder mode memory). */
	onPermissionModePick?: ((mode: LaunchPermissionMode) => void) | undefined;
	/**
	 * Chin picks held by the caller (the home draft shares them with the start card); with both set they replace the
	 * composer's own, and the caller applies the folder-switch drop.
	 */
	launchOptions?: LaunchOptions | undefined;
	onLaunchOptionsChange?: ((options: LaunchOptions) => void) | undefined;
	/** The home draft's try-auto coach mark offer (`ChinLaunchControls.tryAutoCoach`). */
	tryAutoCoach?: TryAutoCoachOffer | undefined;
	/** An idle live pane: chin picks steer it instead of becoming launch flags. */
	live?: LiveLaunchControls | undefined;
	/** The session whose working directory feeds the "@" file mention popup. */
	mentionSessionId?: string | undefined;
	/** Without a session, the folder whose files feed the "@" popup (the home draft's chosen project). */
	mentionFolder?: string | undefined;
	/** That session's working directory: mention and path chips' file-actions menus resolve against it. */
	mentionCwd?: string | undefined;
	/** The "@" sources ahead of Files, in upstream's order (Agents, then Sessions). */
	mentionProviders?: readonly MentionProvider[] | undefined;
	/** The home draft's picked `@` agent, shown as a strip tile with a remove button. */
	agentTile?: AgentTileProps | undefined;
	/** Files the session produced, ranked into "@" file searches (upstream's outputs). */
	mentionOutputs?: readonly MentionOutputFile[] | undefined;
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
	/** The session's prior shell commands, newest first, that ↑/↓ walk in bash mode (upstream getBashHistory). */
	bashHistory?: readonly string[] | undefined;
	/** Subscribes to requests that replace the draft, focus it and put the caret at the end. */
	subscribePrefill?: ((listener: (text: string) => void) => () => void) | undefined;
	/** Upstream's `isPanelActive`: only the active pane's composer gives its file input the upload id and takes type-to-focus keys. */
	active?: boolean | undefined;
	/**
	 * A sent `/rewind`'s outcome, by upstream's gate (`dn`): `ready` clears the composer and opens the
	 * Rewind picker; the others keep the draft. Absent, `/rewind` reaches the CLI as typed.
	 */
	rewind?: ComposerRewind | undefined;
	/**
	 * A session's `/advisor` host dialog: a bare `/advisor` clears the composer and calls `open` (upstream's
	 * `Kae(e) && advisorDialog && z("advisor")`). Absent, or with arguments, `/advisor` reaches the CLI as typed.
	 */
	advisor?:
		|
		  {
				open: () => void;
		  }
		| undefined;
	/**
	 * Upstream's `/output-style` intercept. In a session: the styles (undefined when none are available), whether they
	 * are still loading, and the picker opener; a known style argument reaches the CLI as `/output-style <name>`.
	 * Before a session (home): a warning toast whose "Open settings" calls `openSettings`. Absent, it reaches the CLI.
	 */
	outputStyle?: ComposerOutputStyle | undefined;
	/**
	 * A session's Memory dialog: `/memory` (arguments allowed, upstream's `jf`) clears the composer and calls `open`.
	 * On the home composer `/memory` is refused with a warning toast and kept; absent in a session, it reaches the CLI.
	 */
	memory?:
		|
		  {
				open: () => void;
		  }
		| undefined;
	/** Upstream's non-dialog `/mcp`: an exact `/mcp` clears the composer and opens Customize › Connectors. */
	openConnectors?: (() => void) | undefined;
	/** Upstream's `/skills`: a bare `/skills` clears the composer and opens Customize › Skills › Yours. */
	openSkills?: (() => void) | undefined;
	/** The session's Plan pane facts for `/plan`: whether it has a plan, or older history that may hold one. */
	plan?:
		|
		  {
				hasPlan: boolean;
				olderMessagesNotLoaded: boolean;
		  }
		| undefined;
	/**
	 * Opens the session rail's Context card for a bare `/autocompact` (upstream's `context-popover`
	 * action), after the composer clears it. Upstream's consumers take the request in order: the rail
	 * card first, and only where no rail card takes it, the ring popover in context mode. Absent on the
	 * home composer, where a bare `/autocompact` is refused with a toast and kept.
	 */
	onOpenContext?: (() => void) | undefined;
	/**
	 * A session's `/status` host command: `show` appends the Session info card for the command as sent;
	 * while `turnActive` a spawn notice keeps the text instead. The home composer has none and notes
	 * that the session hasn't started; a session composer without it lets `/status` reach the CLI.
	 */
	statusCommand?: ComposerStatusCommand | undefined;
	/**
	 * `/usage` and `/cost` as host commands: the Usage card on an idle session, else Settings › Usage, the draft cleared
	 * either way. Without it they reach the CLI.
	 */
	usageCommand?: ComposerUsageCommand | undefined;
	/**
	 * Whether a sent `/login` (`/logout`) reaches a live CLI's TUI. False on a session whose sends would fork
	 * headlessly, where upstream's bridged sign-in toast replaces the send; undefined passes it through.
	 */
	signInRunsInTerminal?: boolean | undefined;
	/**
	 * Runs a bash-mode command in the session's live pane; resolves false when it was refused. Present only with a
	 * live pane: `!` in the empty composer then enters upstream's bash mode. Without it, a `! command` send is refused.
	 */
	onShellCommand?: ((command: string) => Promise<boolean>) | undefined;
}

/** Upstream `gc`: a Shiki token's colour and italic / bold bits as inline style. */
function bashTokenStyle(token: ThemedToken): CSSProperties
{
	const fontStyle = token.fontStyle ?? 0;
	return {
		color: token.color,
		...((fontStyle & 1) !== 0 &&
		{
			fontStyle: "italic",
		}),
		...((fontStyle & 2) !== 0 &&
		{
			fontWeight: "bold",
		}),
	};
}

/** The bash-mode command, painted line by line over the transparent editor. */
/** Keeps the pane host in the composer's ref without re-rendering the composer when the layout changes. */
const PaneHostBridge = memo(function PaneHostBridge({hostRef}: {hostRef: React.RefObject<PaneHostApi | null>}): null
{
	const host = useOptionalPaneHost();
	useLayoutEffect(() =>
	{
		hostRef.current = host;
	}, [host, hostRef]);
	return null;
});

function BashHighlight({lines}: {lines: ThemedToken[][]})
{
	return lines.map((tokens, line) => (
		<Fragment key={line}>
			{line > 0 && "\n"}
			{tokens.map((token, index) => (
				<span key={index} data-bash-token="" style={bashTokenStyle(token)}>
					{token.content}
				</span>
			))}
		</Fragment>
	));
}

/** Upstream's `bNdvwB`: a bare `/autocompact` on the home draft, before any session exists. */
const AUTOCOMPACT_BEFORE_SESSION =
	"Context settings work once this session starts. Send your first message to start it.";

/** Upstream's `ULkDZO`: `/memory` on the home draft, before any session exists. */
const MEMORY_BEFORE_SESSION = "The Memory dialog works once this session starts. Send your first message to start it.";

/** {@link ComposerProps.outputStyle}: a live session's styles and picker, or the home composer's settings link. */
type ComposerOutputStyle =
	|
	  {
			hasSession: true;
			items: readonly OutputStyleItem[] | undefined;
			booting: boolean;
			open: () => void;
	  }
	|
	  {
			hasSession: false;
			openSettings: () => void;
	  };

/** Upstream's `/rewind` toasts for a session that can't rewind, and for one whose computer is offline. */
const REWIND_UNSUPPORTED = "Rewind isn’t available for this session.";
const REWIND_OFFLINE = "Rewind is unavailable while the computer running this session is offline.";
/** Upstream's bash-mode placeholder for a session whose terminal runs the command (`voKGw/`). */
const BASH_PLACEHOLDER = "Run a shell command in the terminal and send the output to Claude";
/** Upstream yg5Igg: the bash placeholder when the full one doesn't fit on one line. */
const BASH_COMPACT_PLACEHOLDER = "Run, send output to Claude";
/** Upstream's placeholder fit probe (`[data-placeholder-fit-probe]`): the full text on one invisible line. */
const PLACEHOLDER_FIT_PROBE_CLASS =
	"invisible me-px whitespace-nowrap before:content-[attr(data-placeholder-fit-probe)]";
/** Upstream gUdQrb: text added while chat text reads as a `! command`. */
const COMMAND_IN_BOX_REFUSAL =
	"A command is in the message box, so nothing was added. Send or clear it first, then try again.";
/** Upstream's stray-Enter window after a shell-line hand-off (c1958b152 `fp = 500`). */
const STRAY_ENTER_MS = 500;
/** Upstream's command-draft test for a prefill (c8f38bf1f `l`), after stripping leading whitespace and format chars. */
const COMMAND_DRAFT_PATTERN = /^[/!]/;

/** Upstream UfDkK7: a take-back refused over a draft, bash mode included. */
const TAKE_BACK_DRAFT_REFUSAL = "The input already has a draft. Clear it to pull this message back in.";
/** Upstream `Pu.bashStatus` / "Chat mode": the sr-only status region's text where bash mode is available. */
const BASH_STATUS = "Bash mode. Press Escape to return to chat.";
const CHAT_STATUS = "Chat mode";
/** Upstream's Badge `variant:"pro" size:"sm"` pill in the actions' trailing slot. */
const BASH_PILL_CLASS =
	"inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full px-2 align-middle font-sans text-caption font-medium bg-[var(--pro-tint)] text-[var(--text-pro)]";
/** Sits just left of the send cell (28px, or the 49px touch split, after its 6px / 8px leading gap). */
const BASH_PILL_SLOT_CLASS =
	"absolute bottom-0 right-[34px] comfortable:right-[36px] pointer-coarse:right-[55px] comfortable:pointer-coarse:right-[57px] flex min-h-7 items-center";
/** Upstream `ed`: the host card's ring while in bash mode (`inset-ring-pro` = `--cds-border-pro`). */
const BASH_CARD_CLASS = "inset-ring-1 inset-ring-[var(--border-pro)]";
/** Room for the pill beside the send cell, so the command never runs under it. */
const BASH_ROW_PADDING_CLASS =
	"pr-[78px]! comfortable:pr-[80px]! pointer-coarse:pr-[99px]! comfortable:pointer-coarse:pr-[101px]!";
/** The placeholder and painted overlays stop short of the pill too. */
const BASH_OVERLAY_CLASS =
	"right-[78px]! comfortable:right-[80px]! pointer-coarse:right-[99px]! comfortable:pointer-coarse:right-[101px]!";

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

/** `nested` is upstream's nested-session Stop, keyed apart from the own Stop so a swap between them crossfades. */
type SendFace = "stop" | "nested" | "send";

/** Upstream's `od`: a plain Send tap this soon after a Stop click is the same finger landing twice. */
const STOP_TAP_GUARD_MS = 500;
const noop = () => undefined;
/* The coarse spacer's inert split never opens, but its menu holds the working items so it measures the same. */
const SPACER_SPLIT_ITEMS: SplitItem[] = [
	{
		label: "Queue for later",
		onSelect: noop,
	},
	{
		label: "Stop",
		separatorBefore: true,
		onSelect: noop,
	},
];

/** Which lane a touch split submit goes to: Send (a steer while working) or the menu's Queue for later. */
type TouchSubmitLane = "send" | "later";

/**
 * Upstream's send-cell crossfade (`Jd`): Stop and Send share one grid cell. When the face flips, the new one
 * fades in while the old one stays mounted, `inert` and hidden, until its `visibility` transition ends.
 */
/**
 * The home composer's environment bar: the place chips, then the chin's pickers. Upstream's collapse hook watches
 * the row and turns the chips to icons once the pickers (or the wrapped chips line) overflow it. Memoized so a
 * keystroke in the composer doesn't re-render it.
 */
const EnvironmentBar = memo(function EnvironmentBar({
	environment,
	worktreeToggle,
	chin,
	launch,
	pickRef,
}: {
	environment: ReactNode;
	worktreeToggle: ReactNode;
	chin: ComposerState | undefined;
	launch: ChinLaunchControls;
	pickRef: Ref<ChinPickHandle>;
})
{
	const {iconOnly, rowRef, chipsRef, pickersRef, modeRef} = useEnvironmentBarIconOnly();
	return (
		<div data-testid="epitaxy-environment-bar" className={ENVIRONMENT_BAR_CLASS}>
			<div ref={rowRef} data-testid="environment-bar-row" className={ENVIRONMENT_BAR_ROW_CLASS}>
				<div ref={chipsRef} className={ENVIRONMENT_BAR_CHIPS_CLASS}>
					<EnvironmentBarIconOnlyContext.Provider value={iconOnly}>
						<div data-testid="environment-bar-place" className={ENVIRONMENT_BAR_PLACE_SLOT_CLASS}>
							{environment}
						</div>
						{worktreeToggle !== undefined && worktreeToggle !== null && (
							<div className={ENVIRONMENT_BAR_WORKTREE_SLOT_CLASS}>{worktreeToggle}</div>
						)}
					</EnvironmentBarIconOnlyContext.Provider>
				</div>
				{chin && (
					<ComposerChin
						state={chin}
						launch={launch}
						surface="bar"
						pickRef={pickRef}
						pickersRef={pickersRef}
						modeRef={modeRef}
					/>
				)}
			</div>
		</div>
	);
});

/** The props a Tooltip puts on its trigger, which the handoff wrapper passes on to the face button. */
interface TooltipTriggerProps
{
	"aria-describedby"?: string | undefined;
	"data-popup-open"?: string | undefined;
}

/**
 * Upstream's send-cell face wrapper (`td`): a `display: contents` span around one face button that hands keyboard
 * focus to the prompt editor when the face stops being usable, unless `stays` says to keep it put.
 */
function SendFaceHandoff({
	usable,
	stays,
	editorRef,
	editorDisabled,
	children,
	...trigger
}: TooltipTriggerProps &
{
	usable: boolean;
	stays?: () => boolean;
	editorRef: React.RefObject<HTMLTextAreaElement | null>;
	editorDisabled: boolean;
	children: ReactElement<TooltipTriggerProps>;
})
{
	const ref = useRef<HTMLSpanElement>(null);
	useFaceFocusHandoff(ref, usable, (face) =>
		stays?.() === true ? null : handoffTarget(editorRef.current, face, editorDisabled),
	);
	return (
		<span ref={ref} className="contents">
			{cloneElement(children, trigger)}
		</span>
	);
}

function SendCrossfade({
	face,
	stop,
	nested,
	send,
}: {
	face: SendFace;
	stop: ReactNode;
	nested?: ReactNode;
	send: ReactNode;
})
{
	const [current, setCurrent] = useState<SendFace>(face);
	const [leaving, setLeaving] = useState<SendFace | null>(null);
	const [flipped, setFlipped] = useState(false);
	if (current !== face)
	{
		setCurrent(face);
		setLeaving(current);
		setFlipped(true);
	}
	function renderFace(name: SendFace, children: ReactNode)
	{
		if (name === face)
		{
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
				onTransitionEnd={(event) =>
				{
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
			{renderFace("nested", nested)}
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
	nestedStop,
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
	editorDisabled,
	stopAskedAt,
}: {
	isStreaming: boolean;
	onStop: (() => void) | undefined;
	nestedStop: NestedStopFace | undefined;
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
	/** The prompt editor, which takes focus back when the split's menu closes or a face hands off. */
	editorRef: React.RefObject<HTMLTextAreaElement | null>;
	/** Whether the editor is disabled, so a face handoff waits for it to re-enable. */
	editorDisabled: boolean;
	/** When the host last asked the turn to stop (Esc included), for the Stop face's handoff rule. */
	stopAskedAt: number | null;
})
{
	const coarse = useCoarsePointer();
	const stopClickAtRef = useRef(Number.NEGATIVE_INFINITY);
	/* Upstream's `stopAskedAtRef`: any Stop ask from this cell; the host reports the rest through `stopAskedAt`. */
	const stopAskedAtRef = useRef(Number.NEGATIVE_INFINITY);
	/* Read through a ref: an unmounting Stop face runs the `stays` of its last render, not this one's. */
	const hostStopAskedAtRef = useRef(stopAskedAt);
	hostStopAskedAtRef.current = stopAskedAt;
	/* Upstream's own-Stop `stays`: a Stop that goes without a recent ask (the turn ended on its own) keeps focus put. */
	const stopStays = () =>
		Date.now() - Math.max(stopAskedAtRef.current, hostStopAskedAtRef.current ?? Number.NEGATIVE_INFINITY) >=
		STOP_TAP_GUARD_MS;
	const forkKeys = useShortcutKeys("fork_with_prompt").keys;
	const cmdEnterKeys = useIsMac() ? "cmd+enter" : "ctrl+enter";
	const working = isStreaming || onStop !== undefined;
	/* Upstream's `I = !busy && !hasContent && !submitQueued ? nestedStop : undefined`: the own turn always wins. */
	const nested = !working && !hasContent ? nestedStop : undefined;
	const nestedShown = nested !== undefined;
	const cellRef = useRef<HTMLDivElement>(null);
	/*
	 * Upstream's `R`: a click this soon after the nested face appears, or after it hands over to the own Stop,
	 * is the same press landing on a face it wasn't meant for (a double-click on Stop as the turn ends).
	 */
	const faceGuardAtRef = useRef(Number.NEGATIVE_INFINITY);
	const wasNestedRef = useRef<boolean | null>(null);
	useEffect(() =>
	{
		const was = wasNestedRef.current;
		wasNestedRef.current = nestedShown;
		if (was === nestedShown || (was === null && !nestedShown)) return;
		faceGuardAtRef.current = Date.now();
		if (nestedShown) return;
		/* Upstream's `fe`: when the nested face goes while it (or nothing) holds focus, the prompt takes it. */
		const active = document.activeElement;
		if (active !== null && active !== document.body && !(cellRef.current?.contains(active) ?? false)) return;
		editorRef.current?.focus(
			{
				preventScroll: true,
			},
		);
	}, [nestedShown, editorRef]);
	const forkRow =
		forkLabel === undefined
			? undefined
			:
				{
					content: forkLabel,
					shortcut: forkKeys,
				};
	const secondary = working
		? [
				...(queueForLater
					? [
							{
								content: "Queue for later",
								shortcut: cmdEnterKeys,
							},
						]
					: []),
				...(forkRow === undefined ? [] : [forkRow]),
			]
		: (forkRow ??
			(sendAndStay
				?
					{
						content: "Send and stay here",
						shortcut: cmdEnterKeys,
					}
				: undefined));
	const send = (
		<Tooltip content="Send" shortcut="enter" secondary={secondary}>
			<SendFaceHandoff
				usable={canSend}
				editorRef={editorRef}
				editorDisabled={editorDisabled}
				aria-describedby={deliveryHint ? hintId : undefined}
			>
				<button
					type="button"
					aria-label="Send"
					data-testid="code-prompt-send"
					onClick={(event) =>
					{
						if (Date.now() - stopClickAtRef.current < STOP_TAP_GUARD_MS) return;
						onSubmit(event);
					}}
					disabled={!canSend}
					className={ICON_BUTTON_CLASS}
				>
					<Icon name="ArrowReturn" size="auto" />
				</button>
			</SendFaceHandoff>
		</Tooltip>
	);
	const stop = () =>
	{
		if (Date.now() - faceGuardAtRef.current < STOP_TAP_GUARD_MS) return;
		stopClickAtRef.current = Date.now();
		stopAskedAtRef.current = Date.now();
		onStop?.();
	};
	const cancel = () =>
	{
		stopAskedAtRef.current = Date.now();
		onCancel?.();
	};
	/* Upstream leaves focus on the body after a menu Stop, so the soft keyboard stays down; other closes refocus the editor. */
	const stopFromMenuRef = useRef(false);
	/*
	 * Upstream drops `showStop` the moment the menu's Stop is tapped, so the split gives way to the plain Send
	 * face with the draft kept. Locally the turn stays working until the pane goes idle, so latch the Stop this
	 * split handed out; a new Stop (the next turn) or none (the turn ended) clears it.
	 */
	const [stopAskedOf, setStopAskedOf] = useState<
	{
		stop: () => void;
	} | null>(null);
	if (stopAskedOf !== null && stopAskedOf.stop !== onStop) setStopAskedOf(null);
	const menuStop = () =>
	{
		stopFromMenuRef.current = true;
		if (onStop !== undefined)
			setStopAskedOf(
				{
					stop: onStop,
				},
			);
		stop();
	};
	const splitFinalFocus = useCallback(() =>
	{
		if (!stopFromMenuRef.current) return editorRef.current;
		stopFromMenuRef.current = false;
		return false;
	}, [editorRef]);
	/*
	 * Upstream's touch split (`ue = showStop && !R && isCoarsePointer`): working with a draft on a coarse
	 * pointer, the cell is a ghost split whose primary steers and whose menu queues or stops.
	 */
	const touchSplit = coarse && !isStreaming && onStop !== undefined && hasContent && stopAskedOf === null;
	/* Upstream's `Te`: the own Stop face holds the cell (working with no draft, or a streamed turn). */
	const stopShown = !touchSplit && nested === undefined && working && (isStreaming || !hasContent);
	const splitItems: SplitItem[] = queueForLater
		? [
				{
					label: "Queue for later",
					onSelect: () =>
					{
						onTouchSubmit("later");
					},
				},
				{
					label: "Stop",
					separatorBefore: true,
					onSelect: menuStop,
				},
			]
		: [
				{
					label: "Stop",
					onSelect: menuStop,
				},
			];
	const face = touchSplit ? (
		<SplitDropdownButton
			variant="ghost"
			size="touch"
			icon={
				<Icon
					name="ArrowReturn"
					size="auto"
					{...(canSend
						? {}
						:
							{
								className: "opacity-40",
							})}
				/>
			}
			aria-label="Send"
			aria-keyshortcuts="Enter"
			menuLabel="More send options"
			side="top"
			align="end"
			items={splitItems}
			finalFocus={splitFinalFocus}
			{...(canSend
				? {}
				:
					{
						"aria-disabled": true,
					})}
			onPrimaryClick={() =>
			{
				if (canSend) onTouchSubmit("send");
			}}
		/>
	) : working || nestedStop !== undefined ? (
		<SendCrossfade
			face={nested === undefined ? (stopShown ? "stop" : "send") : "nested"}
			nested={
				nestedStop !== undefined && (
					<Tooltip content={nestedStop.label}>
						<button
							type="button"
							aria-label={nestedStop.stopping ? nestedStop.stoppingLabel : nestedStop.label}
							data-testid="code-prompt-stop-nested"
							onClick={() =>
							{
								if (nestedStop.stopping || Date.now() - faceGuardAtRef.current < STOP_TAP_GUARD_MS)
									return;
								nestedStop.onStop();
							}}
							className={`relative ${ICON_BUTTON_CLASS}`}
							{...(nestedStop.stopping
								?
									{
										"aria-busy": "true",
										"aria-disabled": "true",
									}
								: {})}
						>
							<span className={nestedStop.stopping ? "opacity-0" : undefined}>
								<Icon name="StopFilled" />
							</span>
							{nestedStop.stopping && (
								<span aria-hidden="true" className="absolute inset-0 grid place-items-center">
									<Spinner size="sm" tone="current" />
								</span>
							)}
						</button>
					</Tooltip>
				)
			}
			stop={
				<Tooltip
					content="Stop"
					{...(isStreaming
						? {}
						:
							{
								shortcut: "escape",
							})}
				>
					<SendFaceHandoff
						key="own"
						usable={stopShown}
						stays={stopStays}
						editorRef={editorRef}
						editorDisabled={editorDisabled}
					>
						<button
							type="button"
							aria-label="Stop"
							aria-keyshortcuts={isStreaming ? undefined : "Escape"}
							data-testid="code-prompt-stop"
							onClick={isStreaming ? cancel : stop}
							className={ICON_BUTTON_CLASS}
						>
							<Icon name="StopFilled" />
						</button>
					</SendFaceHandoff>
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
	if (coarse)
	{
		return (
			<div
				ref={cellRef}
				data-testid="code-prompt-send-cell"
				className="absolute right-0 bottom-0 grid min-h-7 items-center justify-items-end pl-1.5 comfortable:pl-2"
			>
				<div data-send-spacer aria-hidden="true" inert className="invisible col-start-1 row-start-1 flex">
					<SplitDropdownButton
						variant="ghost"
						size="touch"
						icon={<Icon name="ArrowReturn" size="auto" />}
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
		<div
			ref={cellRef}
			data-testid="code-prompt-send-cell"
			className="absolute right-0 bottom-0 flex min-h-7 items-center pl-1.5 comfortable:pl-2"
		>
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
const NO_MENTIONS: readonly AcceptedMention[] = [];
const NO_EMOJI: readonly EmojiItem[] = [];
const NO_MENTION_PROVIDERS: readonly MentionProvider[] = [];
const NO_LAUNCH_OPTIONS: LaunchOptions = {};
/** The model ids and aliases `/model <arg>` accepts: the chin's Model menu rows. */
const HOST_COMMAND_MODELS = [...PRIMARY_MODELS, ...MORE_MODELS].map((model) => model.id);

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
	nestedStop,
	stopAskedAt = null,
	disabled = false,
	dropScope = "page",
	deliveryHint,
	chin,
	usageContext,
	environment,
	worktreeToggle,
	slashCommands = NO_COMMANDS,
	slashMenuHeader,
	slashCommandsLoading = false,
	onSlashMenuOpen,
	compactSlashMenu = COMPACT_SLASH_MENU_HOST,
	slashRemoteControl = null,
	slashEnvironment,
	bypassPermissionsAllowed = false,
	modeBadges,
	autoLockNote,
	permissionCwd,
	onPermissionModePick,
	launchOptions: heldLaunchOptions,
	onLaunchOptionsChange: onHeldLaunchOptionsChange,
	tryAutoCoach,
	live,
	mentionSessionId,
	mentionFolder,
	mentionCwd,
	mentionProviders = NO_MENTION_PROVIDERS,
	mentionOutputs,
	agentTile,
	queue,
	onQueueForLater,
	onFork,
	onSendAndStay,
	forkLabel = "Fork with this prompt",
	promptHistory = NO_HISTORY,
	bashHistory = NO_HISTORY,
	subscribePrefill,
	active = true,
	rewind,
	advisor,
	outputStyle,
	memory,
	openConnectors,
	openSkills,
	plan,
	onOpenContext,
	statusCommand,
	usageCommand,
	signInRunsInTerminal,
	onShellCommand,
}: ComposerProps)
{
	const
	{
		text: prompt,
		setText: setPrompt,
		bashMode: draftBashMode,
		setBashMode,
		clear: clearDraft,
		textKey: draftTextKey,
	} = useComposerDraft(draftKey);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	// Optional: composers rendered outside the app shell (tests, previews) have no toaster.
	const toast = useContext(ToastContext);
	// The session's Background tasks pane, which `/workflows` opens; null on the home composer.
	const backgroundTasks = useBackgroundTasksOpener();
	// The Plan pane `/plan` opens; null on the home composer, and never opened on a phone. Read through a ref
	// filled by PaneHostBridge, so a pane layout change doesn't re-render the composer.
	const paneHostRef = useRef<PaneHostApi | null>(null);
	const phone = usePhoneSheet();
	const hintId = useId();
	const isMac = useIsMac();
	const isWindows = useIsWindows();
	const coarsePointer = useCoarsePointer();
	const slashMenuId = useId();
	const mentionMenuId = useId();
	const [caret, setCaret] = useState(0);
	const pendingCaretRef = useRef<number | null>(null);
	const {queued: queuedComments} = useDiffComments(draftKey);
	const contextChips = useContextChips(draftKey);
	const restoredChipIds = useRestoredChipIds(draftKey);
	// Upstream restores staged attachments with the draft; after mount, so SSR and hydration render none.
	useEffect(() =>
	{
		hydrateStagedChips(draftKey);
	}, [draftKey]);
	// Upstream's bash mode, saved with the draft: only a composer that can run shell commands enters or restores it.
	const bashMode = onShellCommand !== undefined && draftBashMode;
	const bashModeRef = useRef(bashMode);
	bashModeRef.current = bashMode;
	// Upstream restores a saved bash mode only where it's available, and otherwise drops it from the draft.
	useEffect(() =>
	{
		if (onShellCommand === undefined && draftBashMode) setBashMode(false);
	}, [onShellCommand, draftBashMode, setBashMode]);
	const hasContent = bashMode
		? prompt.trim() !== ""
		: prompt.trim() !== "" || queuedComments.length > 0 || contextChips.length > 0;
	const canSend = hasContent && !isStreaming && !disabled;
	const [launch, setLaunch] = useState<
	{
		draftKey: string;
		options: LaunchOptions;
	}>(
		{
			draftKey,
			options: {},
		},
	);
	const setHeldLaunchOptions = heldLaunchOptions === undefined ? undefined : onHeldLaunchOptionsChange;
	const launchOptions =
		setHeldLaunchOptions === undefined
			? launch.draftKey === draftKey
				? launch.options
				: NO_LAUNCH_OPTIONS
			: (heldLaunchOptions ?? NO_LAUNCH_OPTIONS);
	// Upstream's folder-transfer effect (cf6ae6197 `Jt`): a Manual, Accept edits or Plan pick stays with the draft in
	// the new folder, while an Auto or Bypass pick is dropped so that folder's own memory or default takes over.
	const launchFolder = folderModeKey(permissionCwd);
	const [pickFolder, setPickFolder] = useState(launchFolder);
	if (pickFolder !== launchFolder)
	{
		setPickFolder(launchFolder);
		const pick = launchOptions.permissionMode;
		if (
			setHeldLaunchOptions === undefined &&
			pick !== undefined &&
			!carryPickToFolder(
				{
					pick,
				},
			)
		)
		{
			const {permissionMode: _dropped, ...kept} = launchOptions;
			setLaunch(
				{
					draftKey,
					options: kept,
				},
			);
		}
	}
	const [openMenu, setOpenMenu] = useState<ChinMenu | null>(null);
	// The grouped "/" menu's Model row while the model menu is open beside it (upstream's model flyout).
	const [modelFlyout, setModelFlyout] = useState<HTMLElement | null>(null);
	const chinPickRef = useRef<ChinPickHandle>(null);
	// Upstream's literal error band: kept while typing, cleared by Dismiss or the next submit.
	const [commandError, setCommandError] = useState<
	{
		draftKey: string;
		body: string;
	} | null>(null);
	const commandErrorBody = commandError?.draftKey === draftKey ? commandError.body : null;
	// Upstream's spawn notice (`spawnWarning`), cleared by the next submit: the "isn’t a command here" footnote set by
	// the send of an unknown command, or `/status` deferred until the session starts or the running turn ends.
	const [spawnNotice, setSpawnNotice] = useState<
		|
		  {
				draftKey: string;
				kind: "unknown_command";
				name: string;
				suggestion: string | null;
		  }
		|
		  {
				draftKey: string;
				kind: "status";
				cause: "session" | "turn";
				text: string;
		  }
		| null
	>(null);
	// Upstream's `lFe` effect: a turn-caused notice goes once the turn is over.
	if (spawnNotice?.kind === "status" && spawnNotice.cause === "turn" && statusCommand?.turnActive !== true)
		setSpawnNotice(null);
	const shownSpawnNotice = spawnNotice?.draftKey === draftKey ? spawnNotice : null;
	const menuShortcutOptions =
	{
		disabled: chin === undefined,
	};
	useShortcut(
		"open_mode_menu",
		() =>
		{
			setOpenMenu("mode");
		},
		menuShortcutOptions,
	);
	useShortcut(
		"open_model_menu",
		() =>
		{
			setOpenMenu("model");
		},
		menuShortcutOptions,
	);
	useShortcut(
		"open_effort_selector",
		() =>
		{
			setOpenMenu("effort");
		},
		menuShortcutOptions,
	);
	// Upstream's `toggleFastMode`: toggles in a session; the home composer opens the Model menu instead.
	useShortcut(
		"toggle_fast_mode",
		() =>
		{
			if (variant === "home")
			{
				setOpenMenu("model");
				return true;
			}
			const chinPick = chinPickRef.current;
			if (chinPick === null) return false;
			const {on, canToggle} = chinPick.fastState();
			if (!canToggle) return false;
			chinPick.pick(
				{
					fastMode: !on,
				},
			);
			return true;
		},
		menuShortcutOptions,
	);
	const fileInputRef = useRef<HTMLInputElement>(null);
	// The draft the open picker belongs to; upstream (`Ld`) drops a pick when the scope changed while it was open.
	const pickerDraftKeyRef = useRef<string | null>(null);
	const openFilePicker = useCallback(() =>
	{
		pickerDraftKeyRef.current = draftKey;
		fileInputRef.current?.click();
	}, [draftKey]);
	useShortcut(
		"add_files",
		openFilePicker,
		{
			disabled,
		},
	);
	const chinLaunchOptions = live?.options ?? launchOptions;

	// Focus the prompt on mount. A turn's end never takes focus: upstream leaves that to the Stop face's handoff.
	const mountStreamingRef = useRef(isStreaming);
	useEffect(() =>
	{
		if (!mountStreamingRef.current) textareaRef.current?.focus();
	}, []);

	// Upstream remounts its editor per session, so opening one from the sidebar or palette lands focus in the
	// prompt; here a session switch keeps this instance, so a new draft key takes the focus a mount would,
	// under upstream's draft-store swap guards (no overlay or other field holds focus, not a touch screen).
	const focusedDraftKeyRef = useRef(draftKey);
	useEffect(() =>
	{
		if (focusedDraftKeyRef.current === draftKey) return;
		focusedDraftKeyRef.current = draftKey;
		const textarea = textareaRef.current;
		if (
			disabled ||
			textarea === null ||
			document.activeElement === textarea ||
			focusHeldByOverlay(textarea) ||
			focusHeldByField(textarea) ||
			isCoarsePointer()
		)
		{
			return;
		}
		textarea.focus();
	}, [draftKey, disabled]);

	// Upstream's editor onUpdate (`aY`): a change that leaves the same draft empty while the editor is unfocused
	// (a send, a held send landing, a bash run, a host command) brings focus back, unless an overlay or another
	// field holds it. A draft switch, through its restore, is the swap rule above's; typing to empty happens
	// with focus here.
	const emptiedRef = useRef(
		{
			textKey: draftTextKey,
			prompt,
		},
	);
	useLayoutEffect(() =>
	{
		const previous = emptiedRef.current;
		emptiedRef.current =
		{
			textKey: draftTextKey,
			prompt,
		};
		const textarea = textareaRef.current;
		if (
			previous.textKey !== draftTextKey ||
			previous.prompt === "" ||
			prompt !== "" ||
			textarea === null ||
			document.activeElement === textarea ||
			disabled
		)
		{
			return;
		}
		refocusEmptiedEditor(textarea);
	}, [prompt, draftTextKey, disabled]);

	// Chrome blurs a focused textarea the moment it turns disabled and never gives focus back, so a brief
	// `disabled` flicker (a pending herdr send, a pane-state update) left dictation with no target. Note focus
	// on the render that disables the editor, and take it back on re-enable unless the user moved it meanwhile.
	const lockedRef = useRef(false);
	const focusedAtLockRef = useRef(false);
	if (disabled && !lockedRef.current && typeof document !== "undefined")
	{
		focusedAtLockRef.current = textareaRef.current !== null && document.activeElement === textareaRef.current;
	}
	lockedRef.current = disabled;
	useEffect(() =>
	{
		if (disabled || !focusedAtLockRef.current) return;
		focusedAtLockRef.current = false;
		const active = document.activeElement;
		if (active === null || active === document.body) textareaRef.current?.focus();
	}, [disabled]);
	// Upstream's editor zombie guard (`Vu`): a face that handed off while the editor was disabled lands on re-enable.
	const editorDisabled = isStreaming || disabled;
	useEffect(() =>
	{
		const textarea = textareaRef.current;
		if (!editorDisabled && textarea !== null) pickUpHandoff(textarea);
	}, [editorDisabled]);

	const promptRef = useRef(prompt);
	promptRef.current = prompt;
	const draftKeyRef = useRef(draftKey);
	draftKeyRef.current = draftKey;
	const waitingSendRef = useRef(false);
	/**
	 * Upstream's prefill, insert and take-back paths add nothing while a command is in the box: bash mode refuses
	 * an add with uXFFUp and a take-back with the draft message, and chat text reading as `! command` refuses an add.
	 */
	const refuseCommandInBox = useCallback(
		(kind: "add" | "takeBack"): boolean =>
		{
			const message = bashModeRef.current
				? kind === "add"
					? BASH_MODE_REFUSAL
					: TAKE_BACK_DRAFT_REFUSAL
				: kind === "add" && isShellCommandText(promptRef.current)
					? COMMAND_IN_BOX_REFUSAL
					: null;
			if (message === null) return false;
			toast?.(
				{
					kind: "error",
					message,
				},
			);
			return true;
		},
		[toast],
	);
	const bashAvailableRef = useRef(false);
	bashAvailableRef.current = onShellCommand !== undefined;
	const hasAttachmentsRef = useRef(false);
	hasAttachmentsRef.current = contextChips.length > 0 || queuedComments.length > 0;
	// Upstream's stray-Enter guard (`Uc`): until this time, a held Enter or ⌘⏎ after a shell-line hand-off is swallowed.
	const ignoreEnterUntilRef = useRef(0);
	const canPrefillShell = onShellCommand !== undefined;
	/** The slash menu's dismiss setter, declared below; an empty-box prefill keeps the menu closed over its `/command`. */
	const dismissSlashRef = useRef<(dismissed: boolean) => void>(() => {});
	/** Upstream `Tc`: a routed `!` into the empty composer enters bash mode instead of typing. */
	const enterBashFromRoutedText = useCallback(
		(text: string): boolean =>
		{
			if (text !== "!" || !bashAvailableRef.current || bashModeRef.current || promptRef.current !== "")
				return false;
			setBashMode(true);
			return true;
		},
		[setBashMode],
	);
	// Only the active pane's composer takes keys typed outside any field (upstream `paneOwnsTypeToFocus`).
	useTypeToFocus(textareaRef, active && !disabled, enterBashFromRoutedText);
	useEffect(
		() =>
			registerComposer(
				draftKey,
				{
					insertText: (text) =>
					{
						if (refuseCommandInBox("add")) return;
						const next = appendAttachment(promptRef.current, text);
						promptRef.current = next;
						setPrompt(next);
						textareaRef.current?.focus();
					},
					focus: () => textareaRef.current?.focus(),
					setText: (text) =>
					{
						promptRef.current = text;
						setPrompt(text);
						textareaRef.current?.focus();
					},
					getText: () => promptRef.current,
					inBashMode: () => bashModeRef.current,
					submit: () =>
					{
						handleSubmitRef.current();
					},
					prefill: (text) =>
					{
						const refusal = bashModeRef.current
							? BASH_MODE_REFUSAL
							: COMMAND_DRAFT_PATTERN.test(promptRef.current.replace(/^[\s\p{Cf}]+/u, ""))
								? COMMAND_IN_BOX_REFUSAL
								: null;
						if (refusal !== null)
						{
							toast?.(
								{
									kind: "warning",
									message: refusal,
								},
							);
							return false;
						}
						const next = joinPrefill(promptRef.current, text);
						promptRef.current = next;
						pendingCaretRef.current = next.length;
						setCaret(next.length);
						setPrompt(next);
						textareaRef.current?.focus();
						return true;
					},
					prefillEmpty: (text, replaceable, ignoreStrayEnter) =>
					{
						const textarea = textareaRef.current;
						if (textarea === null || textarea.disabled || textarea.readOnly) return "unavailable";
						const verdict = prefillEmptyVerdict(
							promptRef.current,
							text,
							replaceable,
							{
								bashMode: bashModeRef.current,
								sending: waitingSendRef.current,
							},
						);
						if (verdict === "has_draft") return "has_draft";
						if (verdict === "write")
						{
							promptRef.current = text;
							pendingCaretRef.current = text.length;
							setCaret(text.length);
							setPrompt(text);
						}
						dismissSlashRef.current(true);
						textarea.focus();
						if (ignoreStrayEnter) ignoreEnterUntilRef.current = Date.now() + STRAY_ENTER_MS;
						return "inserted";
					},
					takeBack: (text) =>
					{
						if (refuseCommandInBox("takeBack")) return false;
						const next = mergeTakeBack(text, promptRef.current);
						promptRef.current = next;
						pendingCaretRef.current = text.length;
						setCaret(text.length);
						setPrompt(next);
						textareaRef.current?.focus();
						return true;
					},
					...(canPrefillShell
						?
							{
								prefillShell: (command: string, ignoreStrayEnter: boolean): PrefillResult =>
								{
									const textarea = textareaRef.current;
									if (textarea === null || textarea.disabled) return "unavailable";
									const inserted = (): PrefillResult =>
									{
										textarea.focus();
										if (ignoreStrayEnter) ignoreEnterUntilRef.current = Date.now() + STRAY_ENTER_MS;
										return "inserted";
									};
									const hasAttachments = hasAttachmentsRef.current;
									if (
										bashModeRef.current &&
										!hasAttachments &&
										promptRef.current.trim() === command.trim()
									)
										return inserted();
									if (promptRef.current.trim() !== "" || bashModeRef.current || hasAttachments)
										return "has_draft";
									promptRef.current = command;
									bashModeRef.current = true;
									pendingCaretRef.current = command.length;
									setCaret(command.length);
									setPrompt(command);
									setBashMode(true);
									return inserted();
								},
							}
						: {}),
				},
			),
		[draftKey, setPrompt, setBashMode, refuseCommandInBox, toast, canPrefillShell],
	);

	useEffect(
		() =>
			subscribePrefill?.((text) =>
			{
				if (refuseCommandInBox("add")) return;
				const textarea = textareaRef.current;
				textarea?.focus();
				// An unchanged prompt skips the caret layout effect, so place the caret now.
				if (promptRef.current === text) textarea?.setSelectionRange(text.length, text.length);
				else pendingCaretRef.current = text.length;
				promptRef.current = text;
				setCaret(text.length);
				setPrompt(text);
			}),
		[subscribePrefill, setPrompt, refuseCommandInBox],
	);

	// Upstream disables the / and emoji suggestions in bash mode; @ mentions stay on.
	const slash = bashMode
		? null
		: slashTrigger(
				prompt,
				caret,
				{
					midMessageNeedsName: !compactSlashMenu,
				},
			);
	// The menu bolds and gates on the trimmed query, as upstream's menu context trims `resetKey` (`Nb`); ranking and
	// `slashKey` keep the raw query so a trailing space still resets the highlight and can close on an exact head.
	const query = slash?.query.trim() ?? null;
	// Esc dismisses the whole `/` trigger, as upstream does: typing more keeps it closed until the token is gone.
	const [slashDismissed, setSlashDismissed] = useState(false);
	dismissSlashRef.current = setSlashDismissed;
	if (slashDismissed && slash === null) setSlashDismissed(false);
	const slashKey = slash === null ? null : `${slash.start}\0${slash.query}`;
	const [highlight, setHighlight] = useState<
	{
		key: string | null;
		index: number;
	}>(
		{
			key: null,
			index: 0,
		},
	);
	const slashTyped = slash !== null;
	const onSlashMenuOpenRef = useRef(onSlashMenuOpen);
	onSlashMenuOpenRef.current = onSlashMenuOpen;
	useEffect(() =>
	{
		if (slashTyped) onSlashMenuOpenRef.current?.();
	}, [slashTyped]);
	const slashActive = slash !== null && !slashDismissed;
	// Upstream snapshots the usage scores once per menu mount (a pick closes the menu, so it re-reads after one), and
	// reads them only under the grouped menu's gate.
	const [slashPicks, setSlashPicks] = useState(0);
	const slashUsage = useMemo(
		() => (compactSlashMenu && slashTyped ? slashUsageScores(SLASH_USAGE_ACCOUNT) : undefined),
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- slashPicks re-reads the store after a pick
		[compactSlashMenu, slashTyped, slashPicks],
	);
	const matches = slashActive
		? filterSlashCommands(
				slashCommands,
				slash.query,
				{
					getScoreBoost: slashUsage === undefined ? undefined : (candidate) => slashUsage(candidate.usageKey),
				},
			)
		: [];
	const slashLoading = slashActive && slashCommandsLoading;
	const slashHostRows = compactSlashMenu
		? compactSlashHostRows(
				{
					model:
						chin === undefined
							? null
							: chinLaunchOptions.model === undefined
								? chin.model
								: modelLabel(chinLaunchOptions.model),
					inSession: variant === "session",
					environment: slashEnvironment,
					remoteControl: slashRemoteControl,
				},
			)
		: [];
	// Upstream skips the grouped view while the command list is unknown (`sn`).
	const slashGrouped =
		compactSlashMenu && slashActive && !slashLoading && slash.query === "" && slashCommands.length > 0;
	const slashItems: SlashMenuItem[] = slashLoading
		? [
				{
					type: "loading",
				},
			]
		: slashGrouped
			? buildCompactSlashMenu(
					{
						commands: slashCommands,
						notices: slashMenuHeader === undefined ? [] : [slashMenuHeader],
						hostRows: slashHostRows,
						inSession: variant === "session",
						usageScore: (command) => slashUsage?.(slashMatcherCandidate(command).usageKey) ?? 0,
						// Claude Code's bundled skills aren't in the local list, so every skill is the user's own.
						isOwnSkill: () => true,
						labels: COMPACT_SLASH_MENU_LABELS,
					},
				)
			: compactSlashMenu &&
				  slashActive &&
				  matches.length === 0 &&
				  slash.query !== "" &&
				  !/[\s/]/.test(slash.query)
				? [
						// Upstream's gated no-match header keeps the menu open instead of closing it.
						{
							type: "section-header",
							label: NO_MATCH_LABEL,
						},
					]
				: [
						// Upstream ranks a typed query over command rows only (`zq` drops headers), so headers lead the bare `/` alone.
						...(slashMenuHeader === undefined || query !== ""
							? []
							: [
									{
										type: "section-header" as const,
										label: slashMenuHeader,
									},
								]),
						...matches.map((command) => (
						{
							type: "command" as const,
							command,
						})),
					];
	const slashOpen = slashActive && slashItems.length > 0;
	// A mid-line slash opens with nothing highlighted (-1), as upstream's `startsUnselected` does.
	const highlighted =
		highlight.key === slashKey
			? clampSlashHighlight(slashItems, highlight.index)
			: slash?.atStart === true
				? firstSlashHighlight(slashItems)
				: -1;
	const highlightedItem = slashItems[highlighted];
	const highlightedCommand = highlightedItem?.type === "command" ? highlightedItem.command : undefined;
	// Upstream `Nb`'s `submenuOpen` / `submenuActiveIndex`: a nested list opens 150ms after its row is highlighted.
	const [submenu, setSubmenu] = useState<
	{
		key: string | null;
		label: string;
		highlighted: number;
	} | null>(null);
	const submenuRow =
		highlightedItem?.type === "submenu" && highlightedItem.flyout === undefined ? highlightedItem : undefined;
	const openSubmenu =
		submenuRow !== undefined && submenu?.key === slashKey && submenu.label === submenuRow.label ? submenu : null;
	const insideSubmenu = openSubmenu !== null && openSubmenu.highlighted >= 0;
	const submenuItems = submenuRow?.items ?? [];
	const submenuCommandItem = insideSubmenu ? submenuItems[openSubmenu.highlighted] : undefined;
	const submenuCommand = submenuCommandItem?.type === "command" ? submenuCommandItem.command : undefined;
	const pendingSubmenuLabel = openSubmenu === null ? (submenuRow?.label ?? null) : null;
	useEffect(() =>
	{
		if (pendingSubmenuLabel === null) return undefined;
		const timer = setTimeout(() =>
		{
			setSubmenu(
				{
					key: slashKey,
					label: pendingSubmenuLabel,
					highlighted: -1,
				},
			);
		}, SUBMENU_OPEN_DELAY_MS);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [pendingSubmenuLabel, slashKey]);
	// Upstream's `te.current`: the row the user arrowed onto (hover doesn't count), cleared whenever the query changes.
	const [arrowedRow, setArrowedRow] = useState<string | null>(null);
	const [arrowedSlashKey, setArrowedSlashKey] = useState(slashKey);
	if (arrowedSlashKey !== slashKey)
	{
		setArrowedSlashKey(slashKey);
		setArrowedRow(null);
	}
	// In memory only: upstream doesn't restore the chip from a saved draft either.
	const [acceptedChip, setAcceptedChip] = useState<AcceptedSkillChip | null>(null);
	const chip =
		acceptedChip?.draftKey === draftKey && prompt.startsWith(`/${acceptedChip.name}`) ? acceptedChip : null;
	if (acceptedChip !== null && chip === null) setAcceptedChip(null);
	const chipLength = chip === null ? 0 : chip.name.length + 1;
	// Upstream's NodeSelection on the atom: the textarea selects exactly the chip's text.
	const [chipSelection, setChipSelection] = useState(false);
	const chipSelected = chip !== null && chipSelection;
	const argumentHint = chip === null ? null : skillChipArgumentHint(chip, prompt);
	// Accepted @ mentions, in memory only and tied to the exact prompt they were tracked against:
	// any other prompt change (history, prefill, send, remount) drops them, as upstream's reload does.
	const [mentionState, setMentionState] = useState<
	{
		draftKey: string;
		text: string;
		mentions: readonly AcceptedMention[];
	} | null>(null);
	const mentions =
		mentionState?.draftKey === draftKey && mentionState.text === prompt ? mentionState.mentions : NO_MENTIONS;
	// Upstream's epitaxyBashHighlight: the command takes Shiki's bash colours, in the bash-mode mono face.
	const bashLines = useBashHighlight(prompt, bashMode && prompt !== "");
	const bashPainted = bashMode && bashLines !== null;
	const painted = bashPainted || chip !== null || mentions.length > 0;
	const showWorking =
		!bashMode &&
		showsWorkingPlaceholder(
			{
				working: onStop !== undefined && onQueueForLater !== undefined,
				disabled: disabled || isStreaming,
				coarse: coarsePointer,
				isWindows,
			},
		);
	// Upstream's placeholder pair: bash mode has a compact form and its full hint as `aria-description`; the working
	// hint is the compact queue hint at every width (it only ellipsises), described by the spoken full hint.
	const working = workingPlaceholders(isMac);
	const hint = bashMode
		?
			{
				full: BASH_PLACEHOLDER,
				compact: BASH_COMPACT_PLACEHOLDER,
				description: BASH_PLACEHOLDER,
			}
		: showWorking
			?
				{
					full: working.compact,
					compact: working.compact,
					description: working.spoken,
				}
			: undefined;
	const fullPlaceholder = hint?.full ?? PLACEHOLDER[variant];
	// Upstream's fit probe: the compact text shows once the full one overflows one line.
	const [fitProbe, setFitProbe] = useState<HTMLDivElement | null>(null);
	const compact = useIsOverflowing(hint === undefined ? null : fitProbe, fullPlaceholder);
	const placeholder = hint !== undefined && compact ? hint.compact : fullPlaceholder;
	// Upstream's editor hint: the description as aria-description, and the full text as title while it overflows.
	const hintProps =
		hint === undefined
			? {}
			:
				{
					"aria-description": hint.description,
					...(compact
						?
							{
								title: hint.full,
							}
						: {}),
				};
	// The textarea's selection end, so a selection spanning exactly one chip paints it selected.
	const [selectionEnd, setSelectionEnd] = useState(0);
	const selectedMention = mentions.find((m) => m.start === caret && m.end === selectionEnd);
	const rest = prompt.slice(chipLength);
	// The hint sits after the chip line's trailing whitespace, before any blank line below it.
	const restLine = rest.split("\n", 1)[0] ?? "";
	const paintedOverlayRef = useRef<HTMLDivElement>(null);
	const argumentHintSrId = `skill-arg-hint-sr-${useId()}`;

	const mentionSource: FileMentionSource | undefined =
		mentionSessionId === undefined
			? mentionFolder === undefined
				? undefined
				:
					{
						folder: mentionFolder,
					}
			:
				{
					sessionId: mentionSessionId,
				};
	// A caret right after an accepted chip isn't a query: upstream's atom never reopens the menu.
	const mentionsOn = mentionSource !== undefined || mentionProviders.length > 0;
	const trigger =
		!mentionsOn || slashOpen || mentionEndingAt(mentions, caret) !== undefined
			? null
			: fileMentionTrigger(prompt, caret);
	// Esc suppresses the trigger at `start` while its token extends the dismissed one, as upstream does.
	const [dismissedMention, setDismissedMention] = useState<
	{
		start: number;
		token: string;
		/** A popup with no rows (pending or hint only) suppresses only its exact token. */
		exact: boolean;
	} | null>(null);
	const mentionSuppressed =
		trigger !== null &&
		trigger.start === dismissedMention?.start &&
		isMentionSuppressed(dismissedMention.token, `@${trigger.query}`, dismissedMention.exact);
	if (dismissedMention !== null && !mentionSuppressed) setDismissedMention(null);
	const mention = mentionSuppressed ? null : trigger;
	const suggestions = useFileMentionSuggestions(mentionSource, mention?.query ?? null, mentionOutputs);
	const providerAnswers = useMentionProviders(mentionProviders, mention?.query ?? null);
	useEffect(() =>
	{
		if (mentionsOn) void preloadFileTypeIcons();
	}, [mentionsOn]);
	const
	{
		AttachedContextChips,
		ComposerDropScrim,
		EmojiSuggestionMenu,
		MentionMenu,
		ParkedMessageBar,
		QueuedMessageBar,
		QueuedPromoteStatus,
		SlashCommandMenu,
	} = useComposerSurfaces();
	useEffect(() =>
	{
		preloadComposerSurfaces().catch(() => {});
	}, []);
	const fileEntries = suggestions?.entries;
	const mentionOptions = useMemo(
		() =>
			mergeProviderOptions([
				...providerAnswers.map((options) => options ?? []),
				(fileEntries ?? []).map(fileMentionOption),
			]),
		[providerAnswers, fileEntries],
	);
	const mentionQuery = mention?.query ?? "";
	// Upstream's pending blocks: a provider still looking up asks for skeleton rows where its options will land.
	const mentionPending = useMemo(() =>
	{
		const blocks: MentionPendingBlock[] = [];
		let before = 0;
		for (const [index, provider] of mentionProviders.entries())
		{
			const answer = providerAnswers[index];
			if (answer !== undefined)
			{
				before += answer.length;
				continue;
			}
			const pending = provider.pending?.(mentionQuery);
			if (pending !== undefined && pending.rows > 0)
				blocks.push(
					{
						...pending,
						providerId: provider.id,
						before,
					},
				);
		}
		return blocks;
	}, [mentionProviders, providerAnswers, mentionQuery]);
	const mentionLoading = mention !== null && providerAnswers.some((answer) => answer === undefined);
	const mentionAlone = mentionOptions.length === 0;
	const visiblePending = mentionPending.filter((block) => mentionAlone || block.onlyWhenEmpty !== true);
	// Upstream's empty hint: the first provider with one, once nothing came back and nothing is loading.
	const freshHint =
		mention === null || !mentionAlone || mentionLoading
			? undefined
			: mentionProviders.map((provider) => provider.emptyHint?.(mentionQuery)).find((hint) => hint !== undefined);
	const [lastHint, setLastHint] = useState<string | undefined>(undefined);
	// While the next query loads with nothing pending, a hint-only popup keeps its hint rather than flashing closed.
	const mentionHint =
		mention !== null && mentionAlone && mentionLoading && visiblePending.length === 0 ? lastHint : freshHint;
	if (mentionHint !== lastHint) setLastHint(mentionHint);
	const mentionOpen = mention !== null && (!mentionAlone || visiblePending.length > 0 || mentionHint !== undefined);
	const [mentionHighlight, setMentionHighlight] = useState<
	{
		options: readonly MentionOption[];
		index: number;
	}>(
		{
			options: [],
			index: 0,
		},
	);
	const mentionHighlighted =
		mentionHighlight.options === mentionOptions ? Math.min(mentionHighlight.index, mentionOptions.length - 1) : 0;
	// Upstream anchors the popup to the `@` glyph, clamped to the textarea's box: measured once per trigger start (and width),
	// again on resize and whenever the textarea scrolls.
	// The position goes straight onto the popup's DOM node (`left`/`bottom` stay out of its React style), so measuring costs no extra render per keystroke.
	const mentionInputRef = useRef<HTMLDivElement>(null);
	const mentionStart = mentionOpen ? mention.start : null;
	const mentionWidth = mentionMenuWidth(mentionOptions);
	useLayoutEffect(() =>
	{
		if (mentionStart === null) return undefined;
		const place = () =>
		{
			const textarea = textareaRef.current;
			const container = mentionInputRef.current;
			const menu = document.getElementById(mentionPopupId(mentionMenuId));
			if (textarea === null || container === null || menu === null) return;
			const caretRect = textareaCaretRect(textarea, mentionStart);
			const box = textarea.getBoundingClientRect();
			const {left, bottom} = fileMentionMenuPosition(
				{
					at:
					{
						left: box.left + caretRect.left,
						bottom: box.top + caretRect.top + caretRect.height,
					},
					editor: box,
					// Upstream's `@.bottom - @.top`: the glyph's line box.
					lineHeight: caretRect.height,
					container: container.getBoundingClientRect(),
					width: mentionWidth,
					viewportWidth: window.innerWidth,
				},
			);
			menu.style.left = `${left}px`;
			menu.style.bottom = `${bottom}px`;
		};
		place();
		const textarea = textareaRef.current;
		window.addEventListener("resize", place);
		textarea?.addEventListener("scroll", place);
		return () =>
		{
			window.removeEventListener("resize", place);
			textarea?.removeEventListener("scroll", place);
		};
	}, [mentionStart, mentionWidth, mentionMenuId]);

	useLayoutEffect(() =>
	{
		const next = pendingCaretRef.current;
		if (next === null) return;
		pendingCaretRef.current = null;
		textareaRef.current?.setSelectionRange(next, next);
	}, [prompt]);

	/**
	 * Accept dispatches on the provider, as upstream's `onSelect`s do: a file inserts `@path `, a session `@[Title] `,
	 * both tracked as chips; an agent leaves no chip, so its `@query` token is removed.
	 */
	function acceptMention(option: MentionOption)
	{
		if (mention === null) return;
		mentionProviders.find((provider) => provider.id === option.providerId)?.onSelect?.(option);
		let next:
		{
			text: string;
			caret: number;
		};
		let accepted: AcceptedMention | undefined;
		if (option.providerId === "ccp-agents")
		{
			next =
			{
				text: prompt.slice(0, mention.start) + prompt.slice(caret),
				caret: mention.start,
			};
		}
		else if (option.providerId === "ccp-sessions")
		{
			const inserted = `@${option.renderedText} `;
			next =
			{
				text: prompt.slice(0, mention.start) + inserted + prompt.slice(caret),
				caret: mention.start + inserted.length,
			};
			accepted =
			{
				start: mention.start,
				end: next.caret - 1,
				kind: "session",
				sessionId: option.id,
				title: option.label,
			};
		}
		else
		{
			const relPath = option.relPath ?? option.id;
			next = insertFileMention(prompt, mention, caret, relPath);
			// The token runs up to the trailing space.
			accepted =
			{
				start: mention.start,
				end: next.caret - 1,
				kind: "file",
				relPath,
				isDirectory: option.kind === "directory",
			};
		}
		setMentionState(
			{
				draftKey,
				text: next.text,
				mentions: [
					...remapMentions(prompt, next.text, mentions),
					// Bash mode keeps the token plain text: its painted highlight replaces the chip overlay.
					...(accepted === undefined || bashMode ? [] : [accepted]),
				],
			},
		);
		pendingCaretRef.current = next.caret;
		setCaret(next.caret);
		setPrompt(next.text);
		textareaRef.current?.focus();
	}

	function handleMentionKey(e: React.KeyboardEvent): boolean
	{
		if (!mentionOpen) return false;
		// Upstream's arrows, Enter and Tab need rows; a pending- or hint-only popup lets them through to the editor.
		const hasRows = !mentionAlone;
		const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
		if (move !== 0 && hasRows)
		{
			setMentionHighlight(
				{
					options: mentionOptions,
					index: Math.min(Math.max(mentionHighlighted + move, 0), mentionOptions.length - 1),
				},
			);
		}
		else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && hasRows)
		{
			const option = mentionOptions[mentionHighlighted];
			if (option !== undefined) acceptMention(option);
		}
		else if (e.key === "Escape")
		{
			setDismissedMention(
				{
					start: mention.start,
					token: `@${mention.query}`,
					exact: mentionAlone,
				},
			);
			e.stopPropagation();
		}
		else
		{
			return false;
		}
		e.preventDefault();
		return true;
	}

	/** `explicit`: a click, or Enter/Tab on a row the user arrowed onto; only that routes a twin to the CLI. */
	function acceptSlashCommand(
		command: SlashCommand,
		{
			explicit,
		}:
		{
			explicit: boolean;
		},
	)
	{
		if (slash === null) return;
		if (compactSlashMenu)
		{
			recordSlashUsage(SLASH_USAGE_ACCOUNT, slashMatcherCandidate(command).usageKey);
			setSlashPicks((picks) => picks + 1);
		}
		const inserted = `/${command.name} `;
		const next = slash.start + inserted.length;
		pendingCaretRef.current = next;
		setCaret(next);
		setPrompt(prompt.slice(0, slash.start) + inserted + prompt.slice(caret));
		setChipSelection(false);
		// The local menu can open mid-line, but only a leading command becomes a chip.
		setAcceptedChip(
			slash.start === 0
				?
					{
						draftKey,
						name: command.name,
						argumentHint: command.argumentHint,
						routing: explicit && command.shadowsHost === true ? "cli" : null,
					}
				: null,
		);
		textareaRef.current?.focus();
	}

	/** Moves the main list's highlight; a submenu closes when its row loses the highlight. */
	function highlightSlashRow(index: number)
	{
		setHighlight(
			{
				key: slashKey,
				index,
			},
		);
		setSubmenu(null);
	}

	/** Enters an open submenu row's nested list, or opens a flyout row's menu beside it. */
	function enterSlashSubmenu(index: number, row?: HTMLElement)
	{
		const item = slashItems[index];
		if (item?.type !== "submenu") return;
		if (item.flyout === "model")
		{
			const anchor = row ?? document.getElementById(slashCommandOptionId(slashMenuId, index));
			if (anchor === null) return;
			setModelFlyout(anchor);
			setOpenMenu("model");
		}
		else if (item.flyout === "environment")
		{
			setSlashDismissed(true);
			slashEnvironment?.open?.();
		}
		else
		{
			setSubmenu(
				{
					key: slashKey,
					label: item.label,
					highlighted: firstSlashHighlight(item.items),
				},
			);
		}
	}

	/** A click or Enter on a non-command main row: a submenu opens and is entered, a toggle flips and stays open. */
	function activateSlashRow(index: number, row?: HTMLElement)
	{
		const item = slashItems[index];
		if (item?.type === "submenu") enterSlashSubmenu(index, row);
		else if (item?.type === "toggle" && !item.disabled) slashRemoteControl?.toggle?.();
	}

	function handleSlashKey(e: React.KeyboardEvent): boolean
	{
		if (!slashOpen) return false;
		const rtl = document.documentElement.dir === "rtl";
		const enterKey = rtl ? "ArrowLeft" : "ArrowRight";
		const leaveKey = rtl ? "ArrowRight" : "ArrowLeft";
		const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
		if (move !== 0 && insideSubmenu)
		{
			setSubmenu(
				{
					...openSubmenu,
					highlighted: stepSlashHighlight(submenuItems, openSubmenu.highlighted, move),
				},
			);
			setArrowedRow(null);
		}
		else if (move !== 0)
		{
			const index = stepSlashHighlight(slashItems, highlighted, move);
			highlightSlashRow(index);
			const item = slashItems[index];
			setArrowedRow(item?.type === "command" ? slashCommandRowKey(item.command) : null);
		}
		else if (e.key === enterKey)
		{
			// Upstream enters a plain submenu only once it is open; a flyout row opens its menu at once locally.
			const flyout = highlightedItem?.type === "submenu" && highlightedItem.flyout !== undefined;
			if (!flyout && (openSubmenu === null || insideSubmenu)) return false;
			enterSlashSubmenu(highlighted);
		}
		else if (e.key === leaveKey)
		{
			if (!insideSubmenu) return false;
			setSubmenu(
				{
					...openSubmenu,
					highlighted: -1,
				},
			);
		}
		else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey)
		{
			if (insideSubmenu)
			{
				if (submenuCommand !== undefined)
				{
					acceptSlashCommand(
						submenuCommand,
						{
							explicit: true,
						},
					);
				}
			}
			else if (highlightedItem !== undefined && highlightedItem.type !== "command")
			{
				activateSlashRow(highlighted);
			}
			else
			{
				const command = highlightedCommand;
				// Nothing highlighted: upstream closes the menu and lets the key through (Enter sends).
				if (command === undefined)
				{
					setSlashDismissed(true);
					return false;
				}
				acceptSlashCommand(
					command,
					{
						explicit: arrowedRow === slashCommandRowKey(command),
					},
				);
			}
		}
		else if (e.key === "Escape")
		{
			setSlashDismissed(true);
			e.stopPropagation();
		}
		else
		{
			return false;
		}
		e.preventDefault();
		return true;
	}

	function handleSubmit(
		send: (prompt: string, routing?: SlashRouting, options?: LaunchOptions) => void = (text, routing, options) =>
		{
			if (routing === undefined) onSend(text, options ?? launchOptions);
			else onSend(text, options ?? launchOptions, routing);
		},
		trigger?: Event,
	): void
	{
		if (!canSend) return;
		// The session composer's draft is keyed by its session id.
		if (trigger !== undefined && variant === "session") startComposerSubmitJourneys(trigger, draftKey);
		const trimmed = prompt.trim();
		setSpawnNotice(null);
		setCommandError(null);
		if (bashMode)
		{
			// Upstream zO: a command hiding characters stays in the box rather than running.
			if (hasHiddenCharacters(trimmed))
				toast?.(
					{
						kind: "error",
						message: HIDDEN_CHARACTERS_REFUSAL,
					},
				);
			else runShellCommand(trimmed);
			return;
		}
		// Upstream refuses a typed `! command` where nothing can run it, rather than sending it as a prompt.
		if (onShellCommand === undefined && isShellCommandText(trimmed))
		{
			toast?.(
				{
					kind: "error",
					message: shellCommandUnavailableMessage(variant),
				},
			);
			return;
		}
		// Upstream's `Ne`: only the leading chip counts, and the local chip only exists at the start.
		const cliCommandForced = chip?.routing === "cli";
		const planSend = trimmed.startsWith("/") && !cliCommandForced ? runPlanCommand(trimmed, send) : null;
		if (planSend?.kind === "handled") return;
		// A `/plan <description>` goes on as an ordinary prompt, in plan mode.
		const body = planSend?.text ?? trimmed;
		if (planSend === null && trimmed.startsWith("/") && runHostCommand(trimmed, cliCommandForced, send)) return;
		// Other slash commands run as typed; attached context and comments wait for the next real prompt.
		if (planSend === null && trimmed.startsWith("/"))
		{
			noteUnknownCommand(trimmed);
			if (cliCommandForced)
				send(
					trimmed,
					{
						cliCommandForced,
					},
				);
			else send(trimmed);
			clearDraft();
			return;
		}
		const finish = () =>
		{
			const sentChips = takeContextChips(draftKey);
			const comments = takeQueuedDiffComments(draftKey);
			const composed = composePrompt(body, sentChips, comments);
			recordSentAttachments(draftKey, composed, body, sentChips, comments);
			for (const provider of mentionProviders) provider.onSent?.(body, mentions);
			if (planSend?.options === undefined) send(composed);
			else send(composed, undefined, planSend.options);
			clearDraft();
		};
		if (!contextChips.some((chip) => chip.status === "pending"))
		{
			finish();
			return;
		}
		// Upstream's waitForImagesReady: hold the send until uploads settle, and drop it
		// if the prompt or session changed meanwhile. A failed upload's chip is gone by then.
		if (waitingSendRef.current) return;
		waitingSendRef.current = true;
		void waitForPendingUploads(draftKey).then(() =>
		{
			waitingSendRef.current = false;
			if (draftKeyRef.current !== draftKey || promptRef.current !== prompt) return;
			finish();
		});
	}
	/** Bash mode's send: never queued or steered; the composer clears and returns to chat, or takes a refused command back. */
	function runShellCommand(command: string): void
	{
		if (onShellCommand === undefined) return;
		clearDraft();
		setBashMode(false);
		void onShellCommand(command).then((ran) =>
		{
			if (ran || draftKeyRef.current !== draftKey || promptRef.current !== "") return;
			promptRef.current = command;
			pendingCaretRef.current = command.length;
			setCaret(command.length);
			setPrompt(command);
			setBashMode(true);
		});
	}
	/** Upstream's bash-mode keys: `!` in the empty editor enters, Backspace there or Escape (when idle) leaves. */
	function handleBashKey(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean
	{
		if (onShellCommand === undefined || e.altKey || e.metaKey || e.ctrlKey) return false;
		if (!bashMode)
		{
			if (e.key !== "!" || prompt !== "") return false;
			setBashMode(true);
		}
		else if (e.key === "Backspace" && prompt === "")
		{
			setBashMode(false);
		}
		else if (e.key === "Escape" && !e.shiftKey && onStop === undefined && historyNav === null)
		{
			// While Claude works, Escape stops it first, as upstream's working Escape does.
			setBashMode(false);
		}
		else
		{
			return false;
		}
		e.preventDefault();
		return true;
	}
	/** Upstream still sends an unknown command, but explains the CLI's coming "Unknown command" reply. */
	function noteUnknownCommand(text: string): void
	{
		const name = /^\/(\w[\w:-]*)(?=\s|$)/.exec(text)?.[1];
		if (name === undefined || slashCommands.length === 0 || isKnownSlashCommand(name, slashCommands)) return;
		// Locally every command is a CLI command, so the loaded list is the candidate set.
		const candidates = slashCommands.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
		setSpawnNotice(
			{
				draftKey,
				kind: "unknown_command",
				name,
				suggestion: nearestCommand(name, candidates),
			},
		);
	}
	function applySuggestedCommand(command: string): void
	{
		setSpawnNotice(null);
		const rest = prompt.trim();
		const next = rest === "" ? `/${command} ` : `/${command} ${rest}`;
		pendingCaretRef.current = next.length;
		setCaret(next.length);
		setPrompt(next);
		textareaRef.current?.focus();
	}
	/**
	 * Upstream's host interception (`Me`): true when the composer handled it. A CLI-routed twin pick skips every
	 * intercept except `/usage`, which upstream keeps for local-ish sessions.
	 */
	function runHostCommand(text: string, cliCommandForced: boolean, send: (prompt: string) => void): boolean
	{
		if (cliCommandForced) return runUsageCommand(text);
		if (
			runSkillsCommand(text) ||
			runFastCommand(text) ||
			runRewindCommand(text) ||
			runAdvisorCommand(text) ||
			runOutputStyleCommand(text, send) ||
			runMemoryCommand(text) ||
			runMcpCommand(text) ||
			runWorkflowsCommand(text) ||
			runAutocompactCommand(text) ||
			runStatusCommand(text) ||
			runUsageCommand(text) ||
			runSignInCommand(text)
		)
			return true;
		const command = parseHostCommand(
			text,
			{
				effortLevels: effortLevelsFor(chinLaunchOptions.model ?? chin?.modelId ?? CLI_DEFAULT_MODEL),
				models: HOST_COMMAND_MODELS,
				menusAvailable: chin !== undefined,
			},
		);
		if (command === null) return false;
		switch (command.kind)
		{
			case "open":
				setOpenMenu(command.menu);
				clearDraft();
				break;
			case "effort":
				chinPickRef.current?.pick(
					{
						effort: command.level,
					},
				);
				clearDraft();
				break;
			case "model":
				// Upstream accepts any multi-word id; locally the pick must also be a valid `--model` value.
				if (LaunchOptionsSchema.shape.model.safeParse(command.model).success)
				{
					chinPickRef.current?.pick(
						{
							model: command.model,
						},
					);
					clearDraft();
				}
				else
				{
					toast?.(
						{
							kind: "error",
							message: `“${command.model}” isn’t an available model.`,
						},
					);
				}
				break;
			case "refuse":
				toast?.(
					{
						kind: "error",
						message: command.toast,
					},
				);
				break;
			case "band":
				setCommandError(
					{
						draftKey,
						body: command.text,
					},
				);
				break;
		}
		return true;
	}
	/** Upstream's `/status` (`noArgs`): the Session info card, or a spawn notice or band that keeps the text. */
	function runStatusCommand(text: string): boolean
	{
		if (variant === "session" && statusCommand === undefined) return false;
		const route = routeStatusCommand(
			text,
			{
				hasSession: variant === "session",
				turnActive: statusCommand?.turnActive ?? false,
			},
		);
		if (route === null) return false;
		switch (route.kind)
		{
			case "card":
				statusCommand?.show(text.trim());
				clearDraft();
				break;
			case "notice":
				setSpawnNotice(
					{
						draftKey,
						kind: "status",
						cause: route.cause,
						text: route.text,
					},
				);
				break;
			case "band":
				setCommandError(
					{
						draftKey,
						body: route.text,
					},
				);
				break;
			default:
				assertNever(route);
		}
		return true;
	}
	/**
	 * Upstream's `/usage` and `/cost` (`noArgs`): the draft clears before `py` runs, so it clears for the Settings
	 * fallback too; a band keeps the text. Intercepted even when the CLI twin row was picked (upstream's local-ish `z`).
	 */
	function runUsageCommand(text: string): boolean
	{
		if (usageCommand === undefined) return false;
		const route = routeUsageCommand(
			text,
			{
				hasSession: usageCommand.show !== null,
				turnActive: usageCommand.turnActive,
			},
		);
		if (route === null) return false;
		switch (route.kind)
		{
			case "card":
				clearDraft();
				usageCommand.show?.(route.text);
				break;
			case "settings":
				clearDraft();
				usageCommand.openSettings();
				break;
			case "band":
				setCommandError(
					{
						draftKey,
						body: route.text,
					},
				);
				break;
			default:
				assertNever(route);
		}
		return true;
	}
	/** Upstream's bare-only `/autocompact` (`context-popover`); with an argument it reaches the CLI as typed. */
	function runAutocompactCommand(text: string): boolean
	{
		if (autocompactCommand(text) === null) return false;
		if (onOpenContext !== undefined)
		{
			onOpenContext();
			clearDraft();
			return true;
		}
		if (variant !== "home") return false;
		toast?.(
			{
				kind: "error",
				message: AUTOCOMPACT_BEFORE_SESSION,
			},
		);
		return true;
	}
	/** Upstream's `/output-style` (see {@link ComposerProps.outputStyle}). */
	function runOutputStyleCommand(text: string, send: (prompt: string) => void): boolean
	{
		if (outputStyle === undefined) return false;
		const route = parseOutputStyleCommand(
			text,
			outputStyle.hasSession ? outputStyle.items : undefined,
			{
				hasSession: outputStyle.hasSession,
				booting: outputStyle.hasSession && outputStyle.booting,
			},
		);
		if (route === null) return false;
		switch (route.kind)
		{
			case "home":
				toast?.(
					{
						kind: "warning",
						message: route.message,
						...(outputStyle.hasSession
							? {}
							:
								{
									action:
									{
										label: "Open settings",
										onAction: outputStyle.openSettings,
									},
								}),
					},
				);
				break;
			case "refuse":
				toast?.(
					{
						kind: "error",
						message: route.message,
					},
				);
				break;
			case "already":
				clearDraft();
				toast?.(
					{
						kind: "success",
						message: route.message,
					},
				);
				break;
			case "open":
				clearDraft();
				if (outputStyle.hasSession) outputStyle.open();
				break;
			case "send":
				send(route.text);
				clearDraft();
				break;
			default:
				assertNever(route);
		}
		return true;
	}
	/** Upstream's `/memory`: the session's Memory dialog, or a warning before the session starts. */
	function runMemoryCommand(text: string): boolean
	{
		if (!isMemoryCommand(text)) return false;
		if (memory !== undefined)
		{
			clearDraft();
			memory.open();
			return true;
		}
		if (variant !== "home") return false;
		toast?.(
			{
				kind: "warning",
				message: MEMORY_BEFORE_SESSION,
			},
		);
		return true;
	}
	/** Upstream's exact `/mcp` with no session MCP dialog: Customize › Connectors. */
	function runMcpCommand(text: string): boolean
	{
		if (openConnectors === undefined || !isMcpCommand(text)) return false;
		clearDraft();
		openConnectors();
		return true;
	}
	/** Upstream's `sign-in` action for a bridged session: a headless fork can't log in, so toast instead of sending. */
	function runSignInCommand(text: string): boolean
	{
		if (variant !== "session" || signInRunsInTerminal !== false) return false;
		const command = parseSignInCommand(text);
		if (command === null) return false;
		if (command.kind === "band")
		{
			setCommandError(
				{
					draftKey,
					body: command.text,
				},
			);
			return true;
		}
		clearDraft();
		toast?.(
			{
				kind: "error",
				message: command.toast,
				uniqueKey: SIGN_IN_COMMAND_KEY,
			},
		);
		return true;
	}
	/** Upstream's bare-only `/advisor`: opens the host dialog; with arguments it reaches the CLI as typed. */
	function runAdvisorCommand(text: string): boolean
	{
		if (advisor === undefined || !isBareAdvisorCommand(text)) return false;
		clearDraft();
		advisor.open();
		return true;
	}
	/** Upstream's `/rewind` (`noArgs`) dispatch: the shape band first, then the gate's outcome. */
	function runRewindCommand(text: string): boolean
	{
		if (rewind === undefined) return false;
		const shape = parseCommandShape(["rewind"], text);
		if (shape === null) return false;
		if (shape.kind === "run")
		{
			switch (rewind.state)
			{
				case "unsupported":
					toast?.(
						{
							kind: "error",
							message: REWIND_UNSUPPORTED,
						},
					);
					break;
				case "offline":
					toast?.(
						{
							kind: "warning",
							message: REWIND_OFFLINE,
						},
					);
					break;
				case "busy":
					// Upstream's `ignore`: nothing happens and the composer keeps `/rewind`.
					break;
				case "ready":
					clearDraft();
					rewind.open();
					break;
				default:
					assertNever(rewind.state);
			}
		}
		else
		{
			setCommandError(
				{
					draftKey,
					body: shape.kind === "extra_lines" ? extraLinesBody(shape.name) : trailingArgsBody(shape.name),
				},
			);
		}
		return true;
	}
	/**
	 * Upstream's `/plan` (`Xle` + `Zle`, handled before every other host command): opens the Plan pane, says
	 * it's already in plan mode, refuses a command-like description, or switches to plan mode. Returns
	 * `handled` when nothing more should happen, a description to send on as an ordinary prompt (with the
	 * launch options to send it with), or null when `text` isn't `/plan`.
	 *
	 * In a session the CLI's own `/plan` does the switch: `/plan` or `/plan <description>` reaches the pane as
	 * typed, and the CLI enables plan mode and queries the description in one step. On the home draft the
	 * switch is the draft's mode pick (upstream's `C1`), and a description launches in plan mode.
	 *
	 * Deliberate deltas: no 15s mode-switch race or "taking too long" toast (`OVlCQO`) and no "still starting"
	 * toast (`OOUarM`), because the CLI switches synchronously and a herdr launch has no spawning composer;
	 * `/plan open` never reaches the CLI, so it never opens the plan in `$EDITOR` the way the CLI would.
	 */
	function runPlanCommand(
		text: string,
		send: (prompt: string) => void,
	):
		|
		  {
				kind: "handled";
		  }
		|
		  {
				kind: "send";
				text: string;
				options: LaunchOptions | undefined;
		  }
		| null
	{
		const arg = planCommandArg(text);
		if (arg === null) return null;
		const home = variant === "home";
		const paneHost = paneHostRef.current;
		const route = routePlanCommand(
			{
				arg,
				currentMode: chinLaunchOptions.permissionMode ?? chin?.mode?.id ?? "default",
				planSelectable: chin !== undefined,
				hasPlan: plan?.hasPlan === true,
				olderMessagesNotLoaded: plan?.olderMessagesNotLoaded === true,
				canOpenPane: !home && paneHost !== null && !phone,
				paneAlreadyOpen: paneHost?.isOpen("plan") === true,
				cliListsCommand: (name) => isKnownSlashCommand(name, slashCommands),
			},
		);
		if (route.kind !== "run")
		{
			toast?.(
				route.kind === "unavailable"
					?
						{
							kind: "error",
							message: "Plan mode isn’t available for this session.",
							uniqueKey: PLAN_COMMAND_UNAVAILABLE_KEY,
						}
					:
						{
							kind: "error",
							message:
								"/plan takes a description, not a command. Leave out the description’s leading “/” or “!” and try again.",
						},
			);
			return {
				kind: "handled",
			};
		}
		const planOptions: LaunchOptions =
		{
			...chinLaunchOptions,
			permissionMode: "plan",
		};
		if (route.switchToPlan)
		{
			onPermissionModePick?.("plan");
			if (home && route.send === null) launchControls.onLaunchOptionsChange(planOptions);
			else if (!home) send(route.send === null ? "/plan" : `/plan ${route.send}`);
		}
		if (route.openPane) paneHost?.openPane("plan");
		if (route.notice !== null)
			toast?.(
				{
					kind: "success",
					message:
						route.notice === "already_in_plan"
							? "Already in plan mode."
							: "Already in plan mode. No plan written yet.",
					uniqueKey: PLAN_COMMAND_NOTICE_KEY,
				},
			);
		if (route.send === null || (route.switchToPlan && !home))
		{
			clearDraft();
			return {
				kind: "handled",
			};
		}
		return {
			kind: "send",
			text: route.send,
			options: home && route.switchToPlan ? planOptions : undefined,
		};
	}
	/**
	 * Upstream's `/skills` (`Hpe` + `Upe`): a bare `/skills` opens `#customize/skills/yours` in the Settings dialog,
	 * as upstream's in-place `S7` open does when Customize lives there. Once the CLI's command list has loaded it
	 * lists its own `/skills`, so `/skills <text>` and a multi-line `/skills` reach the CLI as typed; before that,
	 * they get upstream's shape bands. Deliberate deltas: no "Skills aren’t available for this account." toast
	 * (`FHzBkk`, `epitaxy-skills-command-unavailable`), because the local Skills page always exists; no cloud
	 * plugin-dialog branch; `hostRowPicked` stays false until host/CLI twin rows exist (slash-cli-builtin-twins).
	 */
	function runSkillsCommand(text: string): boolean
	{
		if (openSkills === undefined) return false;
		const route = routeSkillsCommand(
			{
				text,
				cliListsOwn: slashCommands.length > 0 && isKnownSlashCommand("skills", slashCommands),
				hostRowPicked: false,
			},
		);
		if (route === null) return false;
		if (route === "open")
		{
			clearDraft();
			openSkills();
		}
		else
		{
			setCommandError(
				{
					draftKey,
					body: route === "extra_lines" ? extraLinesBody("skills") : trailingArgsBody("skills"),
				},
			);
		}
		return true;
	}
	/**
	 * Upstream's `/workflows` (alias `/workflow`, `noArgs`): opens the Background tasks pane with its
	 * Finished section expanded. Without a pane to open, it reaches the CLI as typed.
	 */
	function runWorkflowsCommand(text: string): boolean
	{
		if (backgroundTasks === null) return false;
		const shape = parseCommandShape(["workflows", "workflow"], text);
		if (shape === null) return false;
		if (shape.kind === "run")
		{
			clearDraft();
			backgroundTasks.open(
				{
					finished: true,
				},
			);
		}
		else
		{
			setCommandError(
				{
					draftKey,
					body: shape.kind === "extra_lines" ? extraLinesBody(shape.name) : trailingArgsBody(shape.name),
				},
			);
		}
		return true;
	}
	/** Upstream's `/fast [on|off]` routing; anything it leaves unhandled reaches the CLI as typed. */
	function runFastCommand(text: string): boolean
	{
		const arg = fastCommandArg(text);
		const chinPick = chinPickRef.current;
		if (arg === null || chinPick === null) return false;
		const {on, canToggle} = chinPick.fastState();
		const route = routeFastCommand(
			{
				arg,
				on,
				canToggle,
			},
		);
		if (route === "unhandled") return false;
		if (route === "toggle")
			chinPick.pick(
				{
					fastMode: !on,
				},
			);
		else
			toast?.(
				{
					kind: "success",
					message: on ? "Fast mode is already on." : "Fast mode is already off.",
					uniqueKey: FAST_COMMAND_NOTICE_KEY,
				},
			);
		clearDraft();
		return true;
	}
	// The send slot and chin are memoized, so they read the latest render's handlers through refs.
	const handleSubmitRef = useRef(handleSubmit);
	handleSubmitRef.current = handleSubmit;
	const submit = useCallback((event: React.MouseEvent) =>
	{
		handleSubmitRef.current(undefined, event.nativeEvent);
	}, []);
	const onQueueForLaterRef = useRef(onQueueForLater);
	onQueueForLaterRef.current = onQueueForLater;
	const touchSubmit = useCallback((lane: TouchSubmitLane) =>
	{
		const later = onQueueForLaterRef.current;
		if (lane === "later" && later !== undefined) handleSubmitRef.current(later);
		else handleSubmitRef.current();
	}, []);

	// Upstream keys the walk on `${historyResetKey}:${bash|chat}`, so toggling bash mode drops an active walk.
	const [historyWalk, setHistoryWalk] = useState<
	{
		draftKey: string;
		bashMode: boolean;
		nav: HistoryNavigator;
	} | null>(null);
	const historyNav = historyWalk?.draftKey === draftKey && historyWalk.bashMode === bashMode ? historyWalk.nav : null;
	// The last emoticon conversion, while Backspace can still revert it; any other edit clears it.
	const lastEmoticonRef = useRef<
	{
		draftKey: string;
		text: string;
		at: number;
		original: string;
		originalCaret: number;
	} | null>(null);

	// Upstream's emoji-suggestion popup: a `:` token of two or more characters lists matching shortcodes. Off in bash
	// mode, during history recall and while the / or @ menu is open.
	const emojiMenuId = useId();
	const emojiTriggerAt =
		bashMode || historyNav !== null || slashOpen || mentionOpen || caret !== selectionEnd
			? null
			: emojiTrigger(prompt, caret);
	// Esc keeps its token closed while the `:` it opened on is still there; a new `:` token opens again.
	const [dismissedEmoji, setDismissedEmoji] = useState<number | null>(null);
	if (dismissedEmoji !== null && prompt.charAt(dismissedEmoji) !== ":") setDismissedEmoji(null);
	// A press outside closes the popup until the next edit.
	const [emojiClosedFor, setEmojiClosedFor] = useState<string | null>(null);
	if (emojiClosedFor !== null && emojiClosedFor !== prompt) setEmojiClosedFor(null);
	const emojiQuery =
		emojiTriggerAt === null || emojiTriggerAt.start === dismissedEmoji || emojiClosedFor === prompt
			? null
			: emojiTriggerAt.query;
	const [emojiResult, setEmojiResult] = useState<
	{
		query: string;
		items: readonly EmojiItem[];
	} | null>(null);
	useEffect(() =>
	{
		if (emojiQuery === null) return undefined;
		// Upstream `items`: under two characters only warms the table.
		if (emojiQuery.length < 2)
		{
			warmEmoji();
			return undefined;
		}
		let live = true;
		void searchEmoji(emojiQuery).then((items) =>
		{
			if (live)
				setEmojiResult(
					{
						query: emojiQuery,
						items,
					},
				);
		});
		return () =>
		{
			live = false;
		};
	}, [emojiQuery]);
	const emojiItems =
		emojiQuery !== null && emojiQuery.length >= 2 && emojiResult?.query === emojiQuery
			? emojiResult.items
			: NO_EMOJI;
	const emojiOpen = emojiTriggerAt !== null && emojiItems.length > 0;
	// Upstream resets the highlight to the first row whenever the rows change.
	const [emojiHighlight, setEmojiHighlight] = useState<
	{
		items: readonly EmojiItem[];
		index: number;
	} | null>(null);
	const emojiHighlighted = emojiHighlight?.items === emojiItems ? emojiHighlight.index : 0;
	useEffect(() =>
	{
		if (!emojiOpen) return undefined;
		const onMouseDown = (event: MouseEvent) =>
		{
			if (event.target instanceof Node && document.getElementById(emojiMenuId)?.contains(event.target)) return;
			setEmojiClosedFor(promptRef.current);
		};
		document.addEventListener("mousedown", onMouseDown);
		return () =>
		{
			document.removeEventListener("mousedown", onMouseDown);
		};
	}, [emojiOpen, emojiMenuId]);

	/** Upstream's emoji `command`: the emoji replaces the `:query` token, with no trailing space. */
	function acceptEmoji(item: EmojiItem)
	{
		if (emojiTriggerAt === null) return;
		const next = prompt.slice(0, emojiTriggerAt.start) + item.char + prompt.slice(caret);
		const nextCaret = emojiTriggerAt.start + item.char.length;
		if (mentions.length > 0)
		{
			setMentionState(
				{
					draftKey,
					text: next,
					mentions: remapMentions(prompt, next, mentions),
				},
			);
		}
		pendingCaretRef.current = nextCaret;
		setCaret(nextCaret);
		setSelectionEnd(nextCaret);
		setPrompt(next);
		textareaRef.current?.focus();
	}

	function handleEmojiKey(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean
	{
		if (!emojiOpen) return false;
		const modified = e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;
		const move = modified ? 0 : e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
		if (move !== 0)
		{
			setEmojiHighlight(
				{
					items: emojiItems,
					index: (emojiHighlighted + move + emojiItems.length) % emojiItems.length,
				},
			);
		}
		else if ((e.key === "Enter" && !e.shiftKey) || (e.key === "Tab" && !modified))
		{
			const item = emojiItems[emojiHighlighted];
			if (item === undefined) return false;
			acceptEmoji(item);
		}
		else if (e.key === "Escape")
		{
			setDismissedEmoji(emojiTriggerAt.start);
			e.stopPropagation();
		}
		else
		{
			return false;
		}
		e.preventDefault();
		return true;
	}

	function showPrompt(text: string, caretAt: number)
	{
		pendingCaretRef.current = caretAt;
		setCaret(caretAt);
		setPrompt(text);
	}

	/** ↑/↓ walk prior prompts (caret on the first / last line); Esc restores the draft. */
	function handleHistoryKey(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean
	{
		if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return false;
		if (e.key === "Escape")
		{
			if (historyNav === null) return false;
			setHistoryWalk(null);
			showPrompt(historyNav.draft, historyNav.draft.length);
		}
		else
		{
			const {selectionStart, selectionEnd} = e.currentTarget;
			if (!historyKeyApplies(e.key, prompt, selectionStart, selectionEnd)) return false;
			// Bash mode walks the session's shell commands (upstream getBashHistory) and never pulls a queued prompt back.
			const lastQueued = bashMode ? undefined : queue?.items.at(-1);
			if (e.key === "ArrowUp" && historyNav === null && prompt === "" && lastQueued)
			{
				editQueuedPrompt(lastQueued);
			}
			else
			{
				const from = historyNav ?? historyNavigator(bashMode ? bashHistory : promptHistory, prompt);
				const next = e.key === "ArrowUp" ? from.up() : from.down();
				if (next === null) return false;
				setHistoryWalk(
					next.active
						?
							{
								draftKey,
								bashMode,
								nav: next,
							}
						: null,
				);
				showPrompt(next.text, e.key === "ArrowUp" ? 0 : next.text.length);
			}
		}
		e.preventDefault();
		e.stopPropagation();
		return true;
	}

	function editQueuedPrompt(item: QueuedPrompt)
	{
		// Upstream refuses to pull a queued message back over a draft rather than merging them.
		if (prompt.trim() !== "")
		{
			toast?.(
				{
					kind: "warning",
					message: "The input already has a draft. Clear it to pull this message back in.",
				},
			);
			return;
		}
		queue?.remove(item.id);
		pendingCaretRef.current = item.text.length;
		setCaret(item.text.length);
		setPrompt(item.text);
		textareaRef.current?.focus();
	}

	function attachFiles(files: readonly File[])
	{
		// Upstream refuses attachments until the session's meta has loaded; locally that's the launch window.
		if (disabled)
		{
			toast?.(
				{
					kind: "error",
					message: "Files can’t be attached until the session finishes loading. Try again in a moment.",
				},
			);
			return;
		}
		attachUploadedFiles(draftKey, files, (options) => toast?.(options));
	}

	// Upstream's page-scoped drop: a drop anywhere attaches. The hook stays on while launching so the drop
	// toasts instead of opening the file, but the scrim only shows once files can attach.
	const cardRef = useRef<HTMLDivElement>(null);
	const chatPanelDrop = dropScope === "chat-panel";
	const dropState = useFileDropTarget(
		{
			onFileDrop: attachFiles,
			targetRef: cardRef,
			disabled: chatPanelDrop,
		},
	);
	const registerChatDrop = useContext(ChatFileDropContext);
	const dropFromChatPanel = useEffectEvent(attachFiles);
	useEffect(() =>
	{
		if (!chatPanelDrop || registerChatDrop === null) return undefined;
		return registerChatDrop((files) =>
		{
			dropFromChatPanel(files);
		});
	}, [chatPanelDrop, registerChatDrop]);

	function handlePaste(e: React.ClipboardEvent)
	{
		// Upstream's paste guard (`c1958b152` `_c`): a clipboard holding a folder isn't pasted as text, and only the
		// files beside the folder attach.
		const {folders, files} = splitDroppedItems(e.clipboardData.items, e.clipboardData.files);
		if (files.length > 0 || folders.length > 0)
		{
			e.preventDefault();
			if (files.length > 0) attachFiles(files);
		}
	}

	const insertSlash = useCallback(() =>
	{
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
	const parkedItems = useMemo(() => parkedPrompts(queuedItems ?? []), [queuedItems]);
	const launchControls = useMemo<ChinLaunchControls>(() =>
	{
		const apply =
			live === undefined
				? (setHeldLaunchOptions ??
					((options: LaunchOptions) =>
					{
						setLaunch(
							{
								draftKey,
								options,
							},
						);
					}))
				: (options: LaunchOptions) => void live.apply(options);
		return {
			launchOptions: chinLaunchOptions,
			// A model picked from the flyout closes the "/" menu too (upstream's `onDone`).
			onLaunchOptionsChange:
				modelFlyout === null
					? apply
					: (options) =>
						{
							if (options.model !== chinLaunchOptions.model) setSlashDismissed(true);
							apply(options);
						},
			confirmEffortChange: live !== undefined,
			openMenu,
			onOpenMenuChange: (menu) =>
			{
				setOpenMenu(menu);
				if (menu === null) setModelFlyout(null);
			},
			modelFlyout:
				modelFlyout === null
					? null
					:
						{
							anchor: modelFlyout,
							finalFocus: textareaRef,
						},
			bypassPermissionsAllowed,
			modeBadges,
			autoLockNote,
			permissionWorkspace: consentWorkspaceKey(permissionCwd),
			onPermissionModePick,
			tryAutoCoach,
		};
	}, [
		chinLaunchOptions,
		live,
		setHeldLaunchOptions,
		draftKey,
		openMenu,
		modelFlyout,
		bypassPermissionsAllowed,
		modeBadges,
		autoLockNote,
		permissionCwd,
		onPermissionModePick,
		tryAutoCoach,
	]);

	/** Upstream `Cq` is an atom: Backspace after it (or Delete before it) selects it instead of eating a character. */
	function handleChipKey(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean
	{
		if (chip === null) return false;
		const {selectionStart, selectionEnd} = e.currentTarget;
		if (selectionStart !== selectionEnd) return false;
		const edge = e.key === "Backspace" ? chipLength : e.key === "Delete" ? 0 : -1;
		if (selectionStart !== edge) return false;
		e.preventDefault();
		e.currentTarget.setSelectionRange(0, chipLength);
		setCaret(0);
		setChipSelection(true);
		return true;
	}

	/** Keeps the caret and selection edges out of the chip, as they can't enter upstream's atom node. */
	function clampChipSelection(textarea: HTMLTextAreaElement)
	{
		let {selectionStart: start, selectionEnd: end} = textarea;
		if (chip !== null)
		{
			if (start === end && start > 0 && start < chipLength)
			{
				// One step left from the chip's end jumps over it (ArrowLeft); anything else lands after it.
				start = end = start === chipLength - 1 && caret >= chipLength ? 0 : chipLength;
			}
			else
			{
				if (start > 0 && start < chipLength) start = 0;
				if (end > 0 && end < chipLength) end = chipLength;
			}
			if (start !== textarea.selectionStart || end !== textarea.selectionEnd)
			{
				textarea.setSelectionRange(start, end, textarea.selectionDirection);
			}
		}
		// Same for accepted @ mentions: a caret inside one lands after it, or before it when stepping left from its end.
		const inside = start === end ? mentionAt(mentions, start) : undefined;
		if (inside === undefined)
		{
			start = mentionAt(mentions, start)?.start ?? start;
			end = mentionAt(mentions, end)?.end ?? end;
		}
		else
		{
			start = end = start === inside.end - 1 && caret >= inside.end ? inside.start : inside.end;
		}
		if (start !== textarea.selectionStart || end !== textarea.selectionEnd)
		{
			textarea.setSelectionRange(start, end, textarea.selectionDirection);
		}
		setCaret(start);
		setSelectionEnd(end);
		setChipSelection(chip !== null && start === 0 && end === chipLength);
	}

	/**
	 * Upstream's mention is a ProseMirror atom with no shortcuts of its own: Backspace after it (or Delete
	 * before it) removes it in one step, and the arrows select it whole before stepping past it.
	 */
	function handleMentionChipKey(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean
	{
		if (mentions.length === 0 || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return false;
		const {selectionStart, selectionEnd: end} = e.currentTarget;
		const selected = mentions.find((m) => m.start === selectionStart && m.end === end);
		const collapsed = selectionStart === end;
		const textarea = e.currentTarget;
		const selectRange = (start: number, rangeEnd: number) =>
		{
			textarea.setSelectionRange(start, rangeEnd);
			setCaret(start);
			setSelectionEnd(rangeEnd);
		};
		// The chip a collapsed caret sits right after (stepping backward) or right before (forward).
		const besideCaret = (backward: boolean) =>
			collapsed ? (backward ? mentionEndingAt : mentionStartingAt)(mentions, selectionStart) : undefined;
		if (e.key === "Backspace" || e.key === "Delete")
		{
			const target = selected ?? besideCaret(e.key === "Backspace");
			if (target === undefined) return false;
			deleteMention(target);
		}
		else if (e.key === "ArrowLeft" || e.key === "ArrowRight")
		{
			const left = e.key === "ArrowLeft";
			if (selected === undefined)
			{
				const target = besideCaret(left);
				if (target === undefined) return false;
				selectRange(target.start, target.end);
			}
			else
			{
				const edge = left ? selected.start : selected.end;
				selectRange(edge, edge);
			}
		}
		else
		{
			return false;
		}
		e.preventDefault();
		return true;
	}

	/** Removes a chip's token (its trailing space stays, as upstream's `deleteNode`) and leaves the caret there. */
	function deleteMention(target: AcceptedMention)
	{
		const next = prompt.slice(0, target.start) + prompt.slice(target.end);
		setHistoryWalk(null);
		setMentionState(
			{
				draftKey,
				text: next,
				mentions: remapMentions(prompt, next, mentions),
			},
		);
		pendingCaretRef.current = target.start;
		setCaret(target.start);
		setSelectionEnd(target.start);
		setPrompt(next);
	}

	const mentionChipActions: MentionChipActions =
	{
		editorRef: textareaRef,
		cwd: mentionCwd,
		onPress: (target) =>
		{
			const textarea = textareaRef.current;
			if (textarea === null) return;
			textarea.focus();
			textarea.setSelectionRange(target.start, target.end);
			setCaret(target.start);
			setSelectionEnd(target.end);
		},
		onDelete: (target) =>
		{
			deleteMention(target);
			textareaRef.current?.focus();
		},
	};

	/** Upstream's `undoInputRule`: Backspace straight after an emoticon conversion puts the typed emoticon back. */
	function handleEmoticonUndoKey(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean
	{
		const last = lastEmoticonRef.current;
		if (e.key !== "Backspace" || last === null) return false;
		lastEmoticonRef.current = null;
		const {selectionStart, selectionEnd} = e.currentTarget;
		if (
			last.draftKey !== draftKey ||
			last.text !== prompt ||
			selectionStart !== last.at ||
			selectionEnd !== last.at ||
			e.altKey ||
			e.metaKey ||
			e.ctrlKey
		)
			return false;
		e.preventDefault();
		if (mentions.length > 0)
		{
			setMentionState(
				{
					draftKey,
					text: last.original,
					mentions: remapMentions(prompt, last.original, mentions),
				},
			);
		}
		showPrompt(last.original, last.originalCaret);
		setSelectionEnd(last.originalCaret);
		return true;
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>)
	{
		startComposerKeystrokeJourney(e.nativeEvent);
		if (
			e.nativeEvent.isComposing ||
			handleEmoticonUndoKey(e) ||
			handleChipKey(e) ||
			handleMentionChipKey(e) ||
			handleSlashKey(e) ||
			handleMentionKey(e) ||
			handleEmojiKey(e) ||
			handleBashKey(e) ||
			handleHistoryKey(e)
		)
		{
			return;
		}
		if (e.key === "Enter" && !e.shiftKey)
		{
			e.preventDefault();
			const commandChord = e.metaKey || e.ctrlKey;
			// Upstream swallows ⌘⏎ key repeat so a held chord never sends twice, and for 500 ms after a shell-line
			// hand-off also a ⌘⏎ or a held Enter's repeat.
			if (
				(commandChord && e.repeat) ||
				(Date.now() < ignoreEnterUntilRef.current && !e.altKey && (commandChord || e.repeat))
			)
			{
				e.stopPropagation();
				return;
			}
			const trigger = e.nativeEvent;
			if (commandChord && e.altKey && bashMode)
			{
				// Upstream offers no fork from bash mode.
			}
			else if (bashMode)
			{
				handleSubmit(undefined, trigger);
			}
			else if (commandChord && e.altKey && onFork !== undefined)
			{
				handleSubmit((text, _routing, options) =>
				{
					onFork(text, options ?? chinLaunchOptions);
				}, trigger);
			}
			else if (commandChord && !e.altKey && onQueueForLater !== undefined)
			{
				handleSubmit(onQueueForLater, trigger);
			}
			else if (commandChord && !e.altKey && onSendAndStay !== undefined)
			{
				handleSubmit((text, _routing, options) =>
				{
					onSendAndStay(text, options ?? chinLaunchOptions);
				}, trigger);
			}
			else
			{
				handleSubmit(undefined, trigger);
			}
		}
	}

	return (
		<div
			data-cds="ChatComposer"
			data-focus-region="composer"
			data-bash-mode={bashMode ? "true" : undefined}
			className="flex w-full min-w-0 flex-col font-sans"
		>
			<PaneHostBridge hostRef={paneHostRef} />
			{queue !== undefined && (
				<>
					<p aria-live="polite" aria-atomic="true" data-testid="coach-queued-status" className="sr-only">
						{laterItems.length > 0 ? queuedStatusText(laterItems.length) : ""}
					</p>
					<QueuedPromoteStatus key={`${draftKey}:queued-status`} sessionId={draftKey} />
					{/* Upstream's QueuedMessageBar band sits in the dock, 6px above the composer card */}
					<div ref={queueBandSlot} className="mb-1.5 empty:hidden">
						<QueuedMessageBar
							sessionId={draftKey}
							items={laterItems}
							{...(queue.acceptedIds === undefined
								? {}
								:
									{
										acceptedIds: queue.acceptedIds,
									})}
							onEdit={editQueuedPrompt}
							onSendNow={queue.sendNow}
							onRemove={queue.remove}
							onClearAll={queue.clear}
							onReorder={queue.reorder}
						/>
						{queue.parked !== undefined && parkedItems.length > 0 && (
							<ParkedMessageBar
								key={`${draftKey}:parked`}
								sessionId={draftKey}
								items={parkedItems}
								willAutoSend={queue.parked.willAutoSend}
								resetsAt={queue.parked.resetsAt}
								archived={queue.parked.archived}
								flushing={queue.parked.flushing}
								onSendAnyway={queue.parked.sendAnyway}
								onEdit={editQueuedPrompt}
								onRemove={queue.remove}
								listInTranscript={queue.parked.listInTranscript}
							/>
						)}
					</div>
				</>
			)}
			<input
				ref={fileInputRef}
				type="file"
				multiple
				id={active ? "chat-input-file-upload-epitaxy" : undefined}
				tabIndex={-1}
				className="hidden"
				onChange={(e) =>
				{
					const pickedFor = pickerDraftKeyRef.current;
					pickerDraftKeyRef.current = null;
					if (pickedFor === draftKey) attachFiles(Array.from(e.target.files ?? []));
					e.target.value = "";
				}}
			/>
			{commandErrorBody !== null && (
				<div data-composer-command-error className="mb-1.5">
					<ErrorCardShell
						headline="Couldn’t complete that"
						hint={commandErrorBody}
						icon="warning"
						announce="alert"
						onDismiss={() =>
						{
							setCommandError(null);
						}}
					/>
				</div>
			)}
			{commandErrorBody === null && shownSpawnNotice !== null && (
				<ComposerCommandNotice
					text={
						shownSpawnNotice.kind === "unknown_command"
							? `/${shownSpawnNotice.name} isn’t a command here.`
							: shownSpawnNotice.text
					}
					suggestion={shownSpawnNotice.kind === "unknown_command" ? shownSpawnNotice.suggestion : null}
					onUse={applySuggestedCommand}
				/>
			)}
			{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a pointer shortcut that focuses the textarea, which is keyboard-reachable itself */}
			<div
				ref={cardRef}
				data-composer-card
				className={bashMode ? `${COMPOSER_CARD_CLASS} ${BASH_CARD_CLASS}` : COMPOSER_CARD_CLASS}
				onClick={(event) =>
				{
					// A portaled menu's click bubbles here through the React tree; only clicks on the card itself focus.
					// Send and Stop leave focus to their face handoff, as upstream's probes show (a pointer Stop: body).
					if (
						event.target instanceof Element &&
						event.currentTarget.contains(event.target) &&
						event.target.closest('[data-testid="code-prompt-send-cell"]') === null
					)
						textareaRef.current?.focus();
				}}
			>
				{dropState !== "idle" && !disabled && <ComposerDropScrim />}
				{(contextChips.length > 0 || queuedComments.length > 0 || agentTile !== undefined) && (
					<AttachedContextChips
						sessionId={draftKey}
						context={contextChips}
						comments={queuedComments}
						cwd={mentionCwd}
						restoredIds={restoredChipIds}
						agent={agentTile}
					/>
				)}
				<div
					ref={mentionInputRef}
					className={`${COMPOSER_EDITOR_ROW_CLASS} ${bashMode ? BASH_ROW_PADDING_CLASS : "pointer-coarse:pr-[51px] comfortable:pointer-coarse:pr-[53px]"}`}
				>
					<div data-composer-add="" className="absolute left-0 bottom-0 flex min-h-7 items-center">
						<ComposerAddMenu
							onInsertSlash={insertSlash}
							onAddFiles={openFilePicker}
							active={active}
							cwd={mentionCwd}
							sessionId={variant === "session" ? draftKey : undefined}
						/>
					</div>
					{slashOpen && (
						<SlashCommandMenu
							id={slashMenuId}
							items={slashItems}
							query={query ?? ""}
							highlighted={highlighted}
							compactHost={compactSlashMenu}
							grouped={slashGrouped}
							submenu={openSubmenu}
							onHighlight={highlightSlashRow}
							onSubmenuHighlight={(index) =>
							{
								if (openSubmenu !== null)
								{
									setSubmenu(
										{
											...openSubmenu,
											highlighted: index,
										},
									);
								}
							}}
							onActivate={activateSlashRow}
							onAccept={(command) =>
							{
								acceptSlashCommand(
									command,
									{
										explicit: true,
									},
								);
							}}
						/>
					)}
					{mentionOpen && (
						<MentionMenu
							id={mentionMenuId}
							options={mentionOptions}
							highlighted={mentionHighlighted}
							onHighlight={(index) =>
							{
								setMentionHighlight(
									{
										options: mentionOptions,
										index,
									},
								);
							}}
							onAccept={acceptMention}
							pending={visiblePending}
							emptyHint={mentionHint}
						/>
					)}
					{emojiOpen && (
						<EmojiSuggestionMenu
							id={emojiMenuId}
							items={emojiItems}
							highlighted={emojiHighlighted}
							onHighlight={(index) =>
							{
								setEmojiHighlight(
									{
										items: emojiItems,
										index,
									},
								);
							}}
							onAccept={acceptEmoji}
							textarea={textareaRef.current}
							start={emojiTriggerAt.start}
						/>
					)}
					{painted && (
						<div
							ref={paintedOverlayRef}
							aria-hidden="true"
							data-bash-highlight={bashPainted ? "" : undefined}
							className={
								bashMode
									? `${bashFont(PAINTED_OVERLAY_CLASS, true)} ${BASH_OVERLAY_CLASS}`
									: PAINTED_OVERLAY_CLASS
							}
						>
							{bashPainted ? (
								<BashHighlight lines={bashLines} />
							) : (
								<>
									{chip !== null && (
										<ComposerSkillChip
											name={chip.name}
											description={
												slashCommands.find((command) => command.name === chip.name)?.description
											}
											selected={chipSelected}
											onPress={(e) =>
											{
												// Upstream's atom can't hold the caret, so a press on the chip lands it after the chip.
												e.preventDefault();
												const textarea = textareaRef.current;
												if (textarea === null) return;
												textarea.focus();
												textarea.setSelectionRange(chipLength, chipLength);
											}}
										/>
									)}
									{argumentHint === null ? (
										<span data-skill-chip-rest="" className="text-primary">
											{paintMentions(
												rest,
												chipLength,
												mentions,
												selectedMention,
												mentionChipActions,
											)}
										</span>
									) : (
										<>
											<span data-skill-chip-rest="" className="text-primary">
												{paintMentions(
													restLine,
													chipLength,
													mentions,
													selectedMention,
													mentionChipActions,
												)}
											</span>
											<span
												data-testid="slash-argument-hint"
												data-skill-arg-hint="true"
												aria-hidden="true"
												style={
												{
													opacity: 0.5,
												}}
											>
												{argumentHint}
											</span>
											{paintMentions(
												rest.slice(restLine.length),
												chipLength + restLine.length,
												mentions,
												selectedMention,
												mentionChipActions,
											)}
										</>
									)}
								</>
							)}
						</div>
					)}
					{slashOpen && query === "" && (
						<div
							aria-hidden="true"
							className={`${GHOST_OVERLAY_CLASS} left-[30px] comfortable:left-[32px]`}
						>
							<span className="invisible">{prompt}</span>
							<span
								data-testid="slash-filter-placeholder"
								className="ml-0.5 text-ink-muted/75 select-none"
							>
								Type to filter
							</span>
						</div>
					)}
					{hint !== undefined && (
						<div
							aria-hidden="true"
							className={`${bashFont(PLACEHOLDER_OVERLAY_CLASS, bashMode)}${bashMode ? ` ${BASH_OVERLAY_CLASS}` : ""}`}
						>
							<div
								ref={setFitProbe}
								aria-hidden="true"
								data-placeholder-fit-probe={fullPlaceholder}
								className={PLACEHOLDER_FIT_PROBE_CLASS}
							/>
						</div>
					)}
					{prompt === "" && (
						<div
							data-testid="composer-placeholder"
							aria-hidden="true"
							className={`${bashMode ? `${bashFont(PLACEHOLDER_OVERLAY_CLASS, true)} ${BASH_OVERLAY_CLASS}` : PLACEHOLDER_CLAMP_CLASS}${isStreaming || disabled ? " opacity-50" : ""}`}
						>
							{placeholder}
						</div>
					)}
					<textarea
						ref={textareaRef}
						aria-label="Prompt"
						data-focus-region-entry
						// Upstream's contenteditable composer slips past the jump-hint input gate; this textarea opts out.
						data-jump-hint-passthrough=""
						// Upstream c2319b8e9: the chat tile's focus target for the tile focus hand-off.
						data-tile-focus-target=""
						value={prompt}
						onChange={(e) =>
						{
							setHistoryWalk(null);
							let next = e.target.value;
							let nextCaret = e.target.selectionStart;
							lastEmoticonRef.current = null;
							const emoticon =
								!bashMode && historyNav === null
									? typedEmoticon(prompt, next, nextCaret, e.target.selectionEnd)
									: null;
							if (emoticon !== null)
							{
								lastEmoticonRef.current =
								{
									draftKey,
									text: emoticon.text,
									at: emoticon.caret,
									original: next,
									originalCaret: nextCaret,
								};
								next = emoticon.text;
								nextCaret = emoticon.caret;
								pendingCaretRef.current = nextCaret;
							}
							// Upstream `Yg chipArgumentSeparator`: a character typed right after the chip gets a space before it.
							const after = next.charAt(chipLength);
							if (chip !== null && next.startsWith(`/${chip.name}`) && after !== "" && !/\s/.test(after))
							{
								next = `${next.slice(0, chipLength)} ${next.slice(chipLength)}`;
								if (nextCaret >= chipLength) nextCaret += 1;
								pendingCaretRef.current = nextCaret;
							}
							setCaret(nextCaret);
							setSelectionEnd(nextCaret);
							setChipSelection(false);
							if (mentions.length > 0)
							{
								setMentionState(
									{
										draftKey,
										text: next,
										mentions: remapMentions(prompt, next, mentions),
									},
								);
							}
							setPrompt(next);
						}}
						onSelect={(e) =>
						{
							clampChipSelection(e.currentTarget);
						}}
						onScroll={(e) =>
						{
							if (paintedOverlayRef.current !== null)
							{
								paintedOverlayRef.current.scrollTop = e.currentTarget.scrollTop;
							}
						}}
						data-chip-length={chip === null ? undefined : chip.name.length + 1}
						aria-describedby={argumentHint === null ? undefined : argumentHintSrId}
						onKeyDown={handleKeyDown}
						onPaste={handlePaste}
						aria-controls={
							slashOpen ? slashMenuId : mentionOpen ? mentionMenuId : emojiOpen ? emojiMenuId : undefined
						}
						aria-activedescendant={
							slashOpen
								? insideSubmenu
									? slashSubmenuOptionId(slashMenuId, openSubmenu.highlighted)
									: highlighted === -1
										? undefined
										: slashCommandOptionId(slashMenuId, highlighted)
								: mentionOpen && !mentionAlone
									? fileMentionOptionId(mentionMenuId, mentionHighlighted)
									: emojiOpen
										? emojiOptionId(emojiMenuId, emojiHighlighted)
										: undefined
						}
						aria-placeholder={placeholder}
						{...hintProps}
						disabled={isStreaming || disabled}
						rows={1}
						enterKeyHint="enter"
						className={`${bashFont(EDITOR_CLASS, bashMode)} ${painted ? "text-transparent caret-primary" : "text-primary"}`}
						style={
						{
							minHeight: "28px",
							maxHeight: "min(24rem, 40svh)",
						}}
					/>
					{/* Upstream's bash/chat announcement, rendered only where bash mode is available. */}
					{onShellCommand !== undefined && (
						<span role="status" className="sr-only">
							{bashMode ? BASH_STATUS : CHAT_STATUS}
						</span>
					)}
					{/* Upstream `Wn`: always mounted so the live region exists before the hint fills it. */}
					<span
						id={argumentHintSrId}
						data-skill-arg-hint-sr="skill-arg-hint"
						role="status"
						aria-live="polite"
						style={SR_ONLY_STYLE}
					>
						{argumentHint ?? ""}
					</span>
					<SendSlot
						isStreaming={isStreaming}
						onStop={onStop}
						nestedStop={nestedStop}
						onCancel={onCancel}
						onSubmit={submit}
						hasContent={hasContent}
						canSend={canSend}
						deliveryHint={deliveryHint}
						hintId={hintId}
						forkLabel={onFork === undefined ? undefined : forkLabel}
						sendAndStay={onSendAndStay !== undefined}
						queueForLater={onQueueForLater !== undefined && !bashMode}
						onTouchSubmit={touchSubmit}
						editorRef={textareaRef}
						editorDisabled={editorDisabled}
						stopAskedAt={stopAskedAt}
					/>
					{bashMode && (
						<div className={BASH_PILL_SLOT_CLASS}>
							<span
								data-cds="Badge"
								data-bash-pill=""
								aria-hidden="true"
								title="Run as a shell command"
								className={BASH_PILL_CLASS}
							>
								bash
							</span>
						</div>
					)}
				</div>
			</div>
			{environment === undefined ? (
				chin ? (
					<ComposerChin
						state={chin}
						launch={launchControls}
						surface="chin"
						pickRef={chinPickRef}
						usageContext={usageContext}
					/>
				) : (
					<ComposerChinFrame />
				)
			) : (
				<EnvironmentBar
					environment={environment}
					worktreeToggle={worktreeToggle}
					chin={chin}
					launch={launchControls}
					pickRef={chinPickRef}
				/>
			)}
		</div>
	);
}
