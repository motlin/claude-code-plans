import {SessionTileGeometryReadyContext} from "./session-tile-geometry-context";
import React, {
	Suspense,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type Context,
	type ReactNode,
} from "react";
import {flushSync} from "react-dom";
import {AlertTriangle, Bot, FileWarning, GitBranch, Lock, Palette, Plug, Zap} from "lucide-react";
import {assertNever} from "../lib/assert-never";
import {isWithdrawnQuestion, type AskedCall} from "../lib/ask-user-question";
import {ErrorCardShell} from "./error-card-shell";
import {ShimmerText} from "./shimmer-text";
import {ProseMarkdown} from "./file-refs";
import {MarkdownArticle} from "./markdown-article";
import {TruncatedContent} from "./truncated-content";
import {AgentMessageRow} from "./agent-message-row";
import {AgentNameContext, type AgentNameResolver} from "./agent-name-context";
import {parseAgentMessage, type AgentMessage} from "../lib/agent-message";
import {backgroundNoticeSummary, type NoticeEntry} from "../lib/background-notice-summary";
import {parseTaskNotification, stoppedAgentDescription, type TaskNotification} from "../lib/background-tasks";
import {SlashCommandText} from "./slash-command-chip";
import {SlashCommandsContext} from "./slash-commands-context";
import {UserPlainText} from "./user-plain-text";
import {taskChecklist} from "../lib/task-checklist";
import {splitLeadingSlashCommand, type SlashCommand} from "../lib/slash-commands";
import {getCallRenderer} from "./tool-renderers";
import {buildClientToolCall, buildSubagentLookup, getToolDescription, isArtifactCard} from "./tool-renderers/types";
import type {ClientToolCall} from "./tool-renderers";
import type {LiveToolFailure, SubagentLookup} from "./tool-renderers/types";
import type {Subagent} from "../lib/subagents";
import type {SlowCommand} from "../lib/slow-commands";
import {useSubagentOpener} from "./subagent-opener-context";
import {useBackgroundTasksOpener} from "./background-tasks-opener-context";
import {useClaudeEvents} from "../hooks/use-claude-events";
import {ChevronIcon, CollapsibleSection, CopyButton, DiffStatPill, TerminalOutput} from "./tool-renderers/shared";
import {SystemBanner, type CompactMetadata} from "./system-banner";
import {compactBoundaryLabel, localCommandOutput} from "./system-banner-text";
import {ArtifactLinkBanner, ArtifactWatchBanner} from "./artifact-banner";
import {permissionDecisionLabel, permissionDecisionTitle} from "../lib/permission-decision";
import {DebugLink} from "./debug-link";
import {TranscriptMessageMenu} from "./transcript-context-menu";
import type {TranscriptMessageRef} from "./transcript-actions-context";
import {AssistantMessageActions, UserMessageActions} from "./message-actions";
import {defined} from "../lib/defined";
import {narrationProse} from "../lib/thinking-narration";
import {messageHeading, messageText} from "../lib/transcript-action-targets";
import {WaitingPickupStatus, WaitingUserTurn} from "./waiting-user-turn";
import {assistantTurnDetails, userTurnDetails} from "../lib/turn-metadata";
import {TurnChangesCard} from "./turn-changes-card";
import {collectTurnChanges, lastTurnChangesAnchor, type TurnChanges} from "../lib/turn-changes";
import {useSettings} from "./settings-context";
import type {TranscriptMode} from "../lib/transcript-mode";
import {hmrPersist} from "../lib/hmr-persist";
import type {MessageSessionLine, SessionLine, SessionContentBlock, ToolResultInfo} from "../lib/sessions";
import type {ToolUseBlock} from "../lib/schemas";
import {toolBucket, type ToolBucket} from "../lib/tool-runs";
import {AttachmentBanner, Banner, Pre} from "./attachment-banner";
import {
	stripCommandTags,
	stripHarnessTags,
	parseCommandBlock,
	parseBashInput,
	parseBashOutput,
	hasDiffStats,
	summarizeToolCallStats,
	diffStatsForCall,
	isRequestInterrupted,
} from "../lib/session-utils";
import type {BackgroundCompletionLike, SummarySegment} from "../lib/session-utils";
import {pastTense} from "../lib/past-tense";
import {runningToolLabel, runningToolLabelText, toolLabel} from "../lib/tool-labels";
import {ELAPSED_MIN_SECONDS, formatElapsed} from "../lib/working-marker";
import {usageLimitCard, type UsageLimitCard} from "../lib/usage-limit-notice";
import {useElapsedSeconds} from "../hooks/use-elapsed-seconds";
import {inlinePathImages} from "./inline-path-images";
import {type AttachedImage, UserAttachments} from "./user-attachments";
import {isEditableTarget} from "../lib/shortcuts/match";
import {findScrollContainer} from "./scroll-container";
import {usePromptJump} from "../hooks/use-prompt-jump";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";
import {
	readTranscriptMeasurements,
	discardTranscriptMeasurements,
	rememberTranscriptMeasurements,
	rememberTranscriptHandoff,
	takeTranscriptHandoff,
	type TranscriptReadingAnchor,
} from "../lib/transcript-measurements";
import {ApiRequestDisclosure} from "./api-request-disclosure";
import {jumpToMessage, TRANSCRIPT_JUMP_REQUEST_EVENT} from "../lib/jump-to-message";
import {asRecord, isKeyOf} from "../lib/narrow";
import {toolMarkActivity} from "../lib/working-mark-activity";
import {WorkingMark} from "./working-mark";

function getSourceSessionId(line: SessionLine, fallbackSessionId: string): string {
	return "sessionId" in line && line.sessionId !== undefined ? line.sessionId : fallbackSessionId;
}

export interface SessionChatProps {
	sessionId: string;
	lines: SessionLine[];
	toolResultMap: Map<string, ToolResultInfo>;
	allowedImageRoots?: readonly string[];
	subagents?: Subagent[];
	showThinking?: boolean;
	showTools?: boolean;
	showPassedHooks?: boolean;
	showHookWarnings?: boolean;
	showHookErrors?: boolean;
	showSystemBanners?: boolean;
	showCompactSummaries?: boolean;
	showTranscriptOnly?: boolean;
	/** This session's transcript view; Verbose pre-expands every tool group and row. */
	transcriptMode?: TranscriptMode;
	initialScrollKey?: string;
	/** Stable raw transcript payload identity; changed content makes retained geometry unsafe. */
	measurementSource?: object;
	/** Selected font and layout settings from the main session view. */
	measurementLayout?: string;
	shouldScrollToEnd?: boolean;
	/** The full scroll content, including asynchronously sized composer/footer siblings. */
	scrollContentRef?: React.RefObject<HTMLElement | null>;
	/** The AI summary, shown once as a muted subtitle before the first message. */
	summary?: string | null;
	/** Commands known for this project, so a slash-command chip can show its description. */
	slashCommands?: readonly SlashCommand[];
	/** The tool call the session's permission prompt waits on, whose row keeps its description as written. */
	permissionWaitToolUseId?: string | null;
	/** Whether the CLI is still running, so the prompts waiting in its queue can still be read. */
	sessionLive?: boolean;
	/** The transcript's trailing turn hasn't ended yet, so it draws no end-of-turn card. */
	turnInProgress?: boolean;
	/** An archived session, whose end-of-turn cards offer no Undo, as upstream. */
	archived?: boolean;
	/** Interrupts Claude so it reads the head waiting prompt next: the head row's Send now, busy until it settles. */
	onSendNow?: (() => Promise<void> | void) | undefined;
	/** Focuses the session composer, where a mouse click on Send now leaves focus. */
	onFocusComposer?: (() => void) | undefined;
}

const TranscriptModeContext = createContext<TranscriptMode>("normal");
interface SendNowHandlers {
	sendNow: (() => Promise<void> | void) | undefined;
	focusComposer: (() => void) | undefined;
}
const SendNowContext = createContext<SendNowHandlers>({sendNow: undefined, focusComposer: undefined});

/** A prompt waiting in the CLI's queue, whose head row's Send now interrupts the running turn. */
function QueuedWaitingTurn({entryId, text, head}: {entryId: string; text: string; head: boolean}) {
	const {sendNow, focusComposer} = useContext(SendNowContext);
	return (
		<WaitingUserTurn
			entryId={entryId}
			text={text}
			head={head}
			onSendNow={sendNow}
			onFocusComposer={focusComposer}
		/>
	);
}

interface ExpansionToggle {
	mode: TranscriptMode;
	expanded: boolean;
}

/**
 * The session's disclosure toggles keyed by tool_use id, so a row the virtualizer unmounts
 * comes back in the state the user left it.
 */
const ExpansionStoreContext = createContext<Map<string, ExpansionToggle> | null>(null);

/** Reads a context this module always provides above its consumers, failing loudly when rendered outside it. */
function useProvidedContext<T>(context: Context<T | null>, name: string): T {
	const value = useContext(context);
	if (value === null) throw new Error(`${name} must be rendered inside its provider`);
	return value;
}

/**
 * A disclosure that starts expanded in Verbose and collapsed otherwise, like upstream. A user
 * toggle holds until the transcript mode changes, which resets it to the new mode's default.
 */
function useModeExpansion(key: string): [boolean, () => void] {
	const mode = useContext(TranscriptModeContext);
	const store = useContext(ExpansionStoreContext);
	const [toggle, setToggle] = useState<ExpansionToggle | null>(() => store?.get(key) ?? null);
	const expanded = toggle?.mode === mode ? toggle.expanded : mode === "verbose";
	const flip = useCallback(() => {
		const next = {mode, expanded: !expanded};
		store?.set(key, next);
		setToggle(next);
	}, [mode, expanded, store, key]);
	return [expanded, flip];
}

const autoScrolledLocations = hmrPersist("autoScrolledLocations", () => new Set<string>());
const EMPTY_IMAGE_ROOTS: readonly string[] = [];
const NO_SUBAGENTS: Subagent[] = [];
const EMPTY_SLASH_COMMANDS: readonly SlashCommand[] = [];
const END_FOLLOW_THRESHOLD_PIXELS = 32;

function isDocumentScrollContainer(scroller: Element): boolean {
	return scroller === document.documentElement || scroller === document.scrollingElement;
}

function scrollMetrics(scroller: Element): {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
} {
	if (isDocumentScrollContainer(scroller)) {
		return {
			scrollTop: window.scrollY,
			scrollHeight: document.documentElement.scrollHeight,
			clientHeight: window.innerHeight,
		};
	}
	return scroller;
}

function messageRef(line: MessageSessionLine, fallbackSessionId: string): TranscriptMessageRef | undefined {
	if (line.uuid === undefined) return undefined;
	return {sessionId: getSourceSessionId(line, fallbackSessionId), uuid: line.uuid};
}

function AssistantTurnActions({line, sessionId}: {line: MessageSessionLine; sessionId: string}) {
	const verbose = useContext(TranscriptModeContext) === "verbose";
	return (
		<AssistantMessageActions
			message={messageRef(line, sessionId)}
			text={messageText(line)}
			timestamp={line.timestamp}
			details={assistantTurnDetails(line, {verbose})}
		/>
	);
}

interface AssistantDisplaySpan {
	key: string;
	sourceSessionId: string;
	endpoint: MessageSessionLine;
	anchorLineIndex: number;
	text: string;
}

/** Whether the line asks an AskUserQuestion that has no answer yet. */
function asksPendingQuestion(line: SessionLine, toolResultMap: ReadonlyMap<string, ToolResultInfo>): boolean {
	const content = line.type === "assistant" ? line.message?.content : undefined;
	return (
		Array.isArray(content) &&
		content.some(
			(block) => block.type === "tool_use" && block.name === "AskUserQuestion" && !toolResultMap.has(block.id),
		)
	);
}

/** Rendered assistant contributions, not API request/usage boundaries. */
function collectAssistantDisplaySpans(
	lines: readonly SessionLine[],
	renderProps: LineRenderProps,
	skipSet: ReadonlySet<number>,
	compactionStatuses: ReadonlySet<number>,
): Map<number, AssistantDisplaySpan> {
	const byLine = new Map<number, AssistantDisplaySpan>();
	let current: AssistantDisplaySpan | undefined;
	for (const [index, line] of lines.entries()) {
		const sourceSessionId = getSourceSessionId(line, renderProps.sessionId);
		if (current !== undefined && sourceSessionId !== current.sourceSessionId) current = undefined;
		if (skipSet.has(index) || !isLineVisible(line, renderProps, false)) continue;
		// Injected notifications may look like plain user prompts, but do not start a new span.
		if (
			taskNotificationOf(line) !== null ||
			foldablePeerMessage(lines, index, renderProps.subagentLookup) !== null
		) {
			if (current !== undefined) {
				current.anchorLineIndex = line.lineIndex;
				byLine.set(line.lineIndex, current);
			}
			continue;
		}
		if (isPromptLine(line)) {
			// Upstream ends the span a stopped background agent's notice follows with its status row.
			if (current !== undefined && stoppedAgentNoticeOf(line) !== null) {
				current.anchorLineIndex = stoppedStatusIndex(line);
				byLine.set(current.anchorLineIndex, current);
			}
			current = undefined;
			continue;
		}
		// Upstream sends a hook's message as a synthetic assistant text between a call and its result,
		// and draws a compaction's status row inside the span it follows, the span's actions after it.
		if (isHookSystemMessageLine(line) || compactionStatuses.has(line.lineIndex)) {
			if (current !== undefined) {
				current.anchorLineIndex = line.lineIndex;
				byLine.set(line.lineIndex, current);
			}
			continue;
		}
		if (line.type !== "assistant") continue;
		const text = messageText(line);
		if (current === undefined) {
			current = {
				key: `assistant-span-${line.lineIndex}`,
				sourceSessionId,
				endpoint: line,
				anchorLineIndex: line.lineIndex,
				text,
			};
		} else {
			current.endpoint = line;
			current.anchorLineIndex = line.lineIndex;
			if (text !== "") current.text = current.text === "" ? text : `${current.text}\n\n${text}`;
		}
		byLine.set(line.lineIndex, current);
	}
	return byLine;
}

interface HeldAssistantFooter {
	entryKey: string;
	startRecordIndex: number;
	endRecordIndex: number;
	span: AssistantDisplaySpan;
}

interface AssistantFooterFocus {
	held: HeldAssistantFooter | null;
	setHeld: React.Dispatch<React.SetStateAction<HeldAssistantFooter | null>>;
}

interface AssistantSpanInteraction extends AssistantFooterFocus {
	hoveredKey: string | null;
	focusedKey: string | null;
}

const AssistantSpanInteractionContext = createContext<AssistantSpanInteraction | null>(null);
const AssistantSpanEntryContext = createContext<SessionListEntry | null>(null);

function assistantSpanAt(target: EventTarget | null): string | null {
	return target instanceof Element
		? (target.closest<HTMLElement>("[data-assistant-span]")?.dataset["assistantSpan"] ?? null)
		: null;
}

/** Pointer/focus highlighting stays below the linear transcript-entry builder. */
function AssistantSpanInteractions({children, held, setHeld}: AssistantFooterFocus & {children: React.ReactNode}) {
	const [hoveredKey, setHoveredKey] = useState<string | null>(null);
	const [focusedKey, setFocusedKey] = useState<string | null>(null);
	const value = useMemo(() => ({hoveredKey, focusedKey, held, setHeld}), [hoveredKey, focusedKey, held, setHeld]);
	return (
		<AssistantSpanInteractionContext.Provider value={value}>
			<div
				className="contents"
				onPointerOver={(event) => {
					setHoveredKey(assistantSpanAt(event.target));
				}}
				onPointerOut={(event) => {
					setHoveredKey(assistantSpanAt(event.relatedTarget));
				}}
				onFocusCapture={(event) => {
					setFocusedKey(assistantSpanAt(event.target));
				}}
				onBlurCapture={(event) => {
					setFocusedKey(assistantSpanAt(event.relatedTarget));
				}}
			>
				{children}
			</div>
		</AssistantSpanInteractionContext.Provider>
	);
}

/** Every member has a slot, so a focused footer can remain at its former endpoint. */
function AssistantDisplaySpanFooter({span}: {span: AssistantDisplaySpan}) {
	const interaction = useProvidedContext(AssistantSpanInteractionContext, "AssistantSpanInteractionContext");
	const entry = useProvidedContext(AssistantSpanEntryContext, "AssistantSpanEntryContext");
	const {setHeld} = interaction;
	useEffect(
		() => () => {
			setHeld((held) => (held?.entryKey === entry.key && held.span.key === span.key ? null : held));
		},
		[setHeld, entry.key, span.key],
	);
	const held = interaction.held?.span.key === span.key ? interaction.held : null;
	const isEndpoint = span.anchorLineIndex >= entry.startRecordIndex && span.anchorLineIndex <= entry.endRecordIndex;
	if (held === null ? !isEndpoint : held.entryKey !== entry.key) return null;
	const displayed = held?.span ?? span;
	return (
		<div
			data-assistant-span-footer={span.key}
			onFocusCapture={() => {
				if (interaction.held?.entryKey === entry.key && interaction.held.span.key === span.key) return;
				setHeld({
					entryKey: entry.key,
					startRecordIndex: entry.startRecordIndex,
					endRecordIndex: entry.endRecordIndex,
					span: {...displayed},
				});
			}}
			onBlurCapture={(event) => {
				if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
				setHeld((current) =>
					current?.entryKey === entry.key && current.span.key === span.key ? null : current,
				);
			}}
		>
			<AssistantMessageActions
				message={messageRef(displayed.endpoint, displayed.sourceSessionId)}
				text={displayed.text}
				timestamp={displayed.endpoint.timestamp}
				details={assistantTurnDetails(displayed.endpoint, {verbose: false})}
				hovered={interaction.hoveredKey === span.key || interaction.focusedKey === span.key}
			/>
		</div>
	);
}

function UserTurnActions({
	line,
	sessionId,
	contextText,
	readByClaude = false,
}: {
	line: MessageSessionLine;
	sessionId: string;
	contextText?: string;
	/** A human prompt in the JSONL was taken into a turn by the CLI, so it reads "Read by Claude". */
	readByClaude?: boolean;
}) {
	return (
		<UserMessageActions
			{...(contextText === undefined ? {} : {contextText})}
			readByClaude={readByClaude}
			message={messageRef(line, sessionId)}
			text={messageText(line)}
			timestamp={line.timestamp}
			details={userTurnDetails(line)}
		/>
	);
}

export const SessionChat = React.memo(function SessionChat({
	sessionId,
	lines,
	toolResultMap,
	allowedImageRoots = EMPTY_IMAGE_ROOTS,
	subagents = NO_SUBAGENTS,
	showThinking = false,
	showTools = true,
	showPassedHooks = false,
	showHookWarnings = false,
	showHookErrors = false,
	showSystemBanners = false,
	showCompactSummaries = false,
	showTranscriptOnly = false,
	transcriptMode = "normal",
	initialScrollKey = sessionId,
	measurementSource,
	measurementLayout = "",
	shouldScrollToEnd = true,
	scrollContentRef,
	summary = null,
	slashCommands = EMPTY_SLASH_COMMANDS,
	permissionWaitToolUseId = null,
	sessionLive = false,
	turnInProgress = false,
	archived = false,
	onSendNow,
	onFocusComposer,
}: SessionChatProps) {
	const sendNowHandlers = useMemo(
		() => ({sendNow: onSendNow, focusComposer: onFocusComposer}),
		[onSendNow, onFocusComposer],
	);
	const measurementKey = JSON.stringify([
		sessionId,
		initialScrollKey,
		transcriptMode,
		showThinking,
		showTools,
		showPassedHooks,
		showHookWarnings,
		showHookErrors,
		showSystemBanners,
		showCompactSummaries,
		showTranscriptOnly,
		measurementLayout,
	]);
	const containerRef = useRef<HTMLDivElement>(null);
	const isSubagentSession = sessionId.startsWith("agent-");
	const subagentLookup = useMemo(() => buildSubagentLookup(subagents), [subagents]);
	const launchedAgents = useMemo(() => launchedAgentDescriptions(lines, toolResultMap), [lines, toolResultMap]);
	const resolveAgentName = useCallback<AgentNameResolver>(
		(agentId) => launchedAgents.get(agentId) ?? subagentLookup.byBareId.get(agentId)?.description ?? null,
		[launchedAgents, subagentLookup],
	);
	const backgroundOutcomes = useMemo(() => backgroundLaunchOutcomes(lines, toolResultMap), [lines, toolResultMap]);
	const compactBoundaries = useMemo(() => compactBoundariesBySummary(lines), [lines]);
	const listedLines = useMemo(() => withQueuedPromptsAtTail(lines, sessionLive), [lines, sessionLive]);
	const waitingIds = useMemo(() => queuedEntryIds(listedLines), [listedLines]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) throw new Error("Expected the session chat container to be mounted.");
		const scroller = findScrollContainer(container);
		const scrollEventTarget = isDocumentScrollContainer(scroller) ? window : scroller;
		let pendingLayoutFollow = false;
		const previousMetrics = scrollMetrics(scroller);
		// Pane moves remount this effect after restoring the scrollport. Reattach
		// follow at that restored position without repeating the fresh-visit jump.
		let followsEnd =
			previousMetrics.clientHeight > 0 &&
			previousMetrics.scrollHeight - previousMetrics.scrollTop - previousMetrics.clientHeight <=
				END_FOLLOW_THRESHOLD_PIXELS;
		// Element metrics are live getters; retain values, not the element itself.
		let previousHeight = previousMetrics.scrollHeight;
		let previousClientHeight = previousMetrics.clientHeight;
		let initialFrame: number | undefined;
		let paintedFrame: number | undefined;
		let resizeFrame: number | undefined;
		let touchY: number | undefined;

		const scrollToEnd = () => {
			const {scrollHeight, clientHeight} = scrollMetrics(scroller);
			if (clientHeight === 0) return;
			previousHeight = scrollHeight;
			previousClientHeight = clientHeight;
			if (isDocumentScrollContainer(scroller)) window.scrollTo({top: scrollHeight});
			else scroller.scrollTo({top: scrollHeight});
		};
		const queueLayoutFollow = () => {
			if (!followsEnd || resizeFrame !== undefined) return;
			pendingLayoutFollow = true;
			resizeFrame = requestAnimationFrame(() => {
				resizeFrame = undefined;
				if (followsEnd) scrollToEnd();
				pendingLayoutFollow = false;
			});
		};
		const updateFollowsEnd = () => {
			const {scrollHeight, scrollTop, clientHeight} = scrollMetrics(scroller);
			if (clientHeight === 0) return;
			const extentChanged = scrollHeight !== previousHeight || clientHeight !== previousClientHeight;
			// A row shrink and footer growth can move the browser away from the new end
			// without reader input. Retain follow through its subsequent measurement scrolls.
			followsEnd =
				scrollHeight - scrollTop - clientHeight <= END_FOLLOW_THRESHOLD_PIXELS ||
				(followsEnd && (extentChanged || pendingLayoutFollow));
			previousHeight = scrollHeight;
			previousClientHeight = clientHeight;
			if (followsEnd && extentChanged) queueLayoutFollow();
		};
		const cancelLayoutFollow = () => {
			followsEnd = false;
			pendingLayoutFollow = false;
			if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
			resizeFrame = undefined;
		};
		const scrollReachesOwner = (target: EventTarget | null) => {
			// Nested tool output and composer fields consume upward input before it reaches the transcript.
			for (
				let element = target instanceof Element ? target : null;
				element && element !== scroller;
				element = element.parentElement
			) {
				const style = getComputedStyle(element);
				if (
					(style.overflowY === "auto" || style.overflowY === "scroll") &&
					(element.scrollTop > 0 ||
						style.overscrollBehaviorY === "contain" ||
						style.overscrollBehaviorY === "none")
				)
					return false;
			}
			return true;
		};
		const onWheel = (event: Event) => {
			if (event instanceof WheelEvent && event.deltaY < 0 && scrollReachesOwner(event.target))
				cancelLayoutFollow();
		};
		const onKeyDown = (event: Event) => {
			if (!(event instanceof KeyboardEvent)) return;
			const key = event;
			if (isEditableTarget(key.target) || !scrollReachesOwner(key.target)) return;
			if (
				key.key === "ArrowUp" ||
				key.key === "PageUp" ||
				key.key === "Home" ||
				(key.key === " " && key.shiftKey)
			)
				cancelLayoutFollow();
		};
		const onTouchStart = (event: Event) => {
			if (event instanceof TouchEvent) touchY = event.touches[0]?.clientY;
		};
		const onTouchMove = (event: Event) => {
			if (!(event instanceof TouchEvent)) return;
			const nextY = event.touches[0]?.clientY;
			if (touchY !== undefined && nextY !== undefined && nextY > touchY && scrollReachesOwner(event.target))
				cancelLayoutFollow();
			touchY = nextY;
		};
		const resizeObserver = new ResizeObserver(queueLayoutFollow);
		resizeObserver.observe(container);
		if (scrollContentRef?.current && scrollContentRef.current !== container)
			resizeObserver.observe(scrollContentRef.current);
		scrollEventTarget.addEventListener("scroll", updateFollowsEnd, {passive: true});
		const inputs = [
			["wheel", onWheel],
			["keydown", onKeyDown],
			["touchstart", onTouchStart],
			["touchmove", onTouchMove],
		] as const;
		for (const [type, handler] of inputs)
			scrollEventTarget.addEventListener(type, handler, {passive: true, capture: true});

		if (shouldScrollToEnd && !autoScrolledLocations.has(initialScrollKey)) {
			initialFrame = requestAnimationFrame(() => {
				paintedFrame = requestAnimationFrame(() => {
					autoScrolledLocations.add(initialScrollKey);
					scrollToEnd();
					followsEnd = true;
				});
			});
		}
		return () => {
			resizeObserver.disconnect();
			scrollEventTarget.removeEventListener("scroll", updateFollowsEnd);
			for (const [type, handler] of inputs) scrollEventTarget.removeEventListener(type, handler, true);
			if (initialFrame !== undefined) cancelAnimationFrame(initialFrame);
			if (paintedFrame !== undefined) cancelAnimationFrame(paintedFrame);
			if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
		};
	}, [initialScrollKey, shouldScrollToEnd, scrollContentRef]);

	return (
		<TranscriptModeContext.Provider value={transcriptMode}>
			<SendNowContext.Provider value={sendNowHandlers}>
				<SlashCommandsContext.Provider value={slashCommands}>
					<PermissionWaitContext.Provider value={permissionWaitToolUseId}>
						<AgentNameContext.Provider value={resolveAgentName}>
							<BackgroundOutcomeContext.Provider value={backgroundOutcomes}>
								<CompactBoundaryContext.Provider value={compactBoundaries}>
									<div
										ref={containerRef}
										className={`${CHAT_COLUMN_CLASS} pt-4 pb-4 text-body transcript-text`}
									>
										{summary !== null && summary !== "" && (
											<p
												data-testid="session-summary-row"
												title={summary}
												className="mb-4 truncate text-sm text-t6"
											>
												{summary}
											</p>
										)}
										<SessionLineList
											key={sessionId}
											lines={listedLines}
											sessionId={sessionId}
											toolResultMap={toolResultMap}
											allowedImageRoots={allowedImageRoots}
											subagentLookup={subagentLookup}
											isSubagentSession={isSubagentSession}
											showThinking={showThinking}
											showTools={showTools}
											showPassedHooks={showPassedHooks}
											showHookWarnings={showHookWarnings}
											showHookErrors={showHookErrors}
											showSystemBanners={showSystemBanners}
											showCompactSummaries={showCompactSummaries}
											showTranscriptOnly={showTranscriptOnly}
											shouldScrollToEnd={shouldScrollToEnd}
											measurementKey={measurementKey}
											measurementSource={measurementSource}
											turnInProgress={turnInProgress}
											archived={archived}
										/>
										{sessionLive && (
											<WaitingPickupStatus key={`pickup-${sessionId}`} waitingIds={waitingIds} />
										)}
									</div>
								</CompactBoundaryContext.Provider>
							</BackgroundOutcomeContext.Provider>
						</AgentNameContext.Provider>
					</PermissionWaitContext.Provider>
				</SlashCommandsContext.Provider>
			</SendNowContext.Provider>
		</TranscriptModeContext.Provider>
	);
});

/**
 * Build a set of line indices that should be skipped because they've been
 * coalesced into a preceding line (e.g., bash-output following bash-input).
 */
function buildSkipSet(lines: SessionLine[]): Set<number> {
	const skip = new Set<number>();
	for (const [i, line] of lines.entries()) {
		const next = lines[i + 1];
		if (next === undefined) break;
		if (line.type === "user" && next.type === "user" && hasBashInput(line) && hasBashOutput(next)) {
			skip.add(i + 1);
		}
	}
	return skip;
}

/**
 * A local command the CLI ran itself ("/model", "/mcp") and its output: the
 * command line a local-command caveat opens, and every local-command stdout.
 * Upstream draws none of these, so only Verbose keeps them.
 */
function localCommandIndices(lines: readonly SessionLine[]): number[] {
	const stringContent = (line: SessionLine | undefined): string | null =>
		line?.type === "user" && typeof line.message?.content === "string" ? line.message.content : null;
	return lines.flatMap((line, index) => {
		const content = stringContent(line);
		if (content === null) return [];
		if (content.startsWith("<local-command-stdout>")) return [index];
		const local =
			content.includes("<command-name>") &&
			stringContent(lines[index - 1])?.startsWith("<local-command-caveat>") === true;
		return local ? [index] : [];
	});
}

interface LineRenderProps {
	sessionId: string;
	toolResultMap: Map<string, ToolResultInfo>;
	allowedImageRoots: readonly string[];
	subagentLookup: SubagentLookup;
	isSubagentSession: boolean;
	showThinking: boolean;
	showTools: boolean;
	showPassedHooks: boolean;
	showHookWarnings: boolean;
	showHookErrors: boolean;
	showSystemBanners: boolean;
	showCompactSummaries: boolean;
	showTranscriptOnly: boolean;
}

/**
 * Upstream claude.ai/code pads every turn wrapper by --chat-turn-gap and
 * collapses that padding when the turn renders nothing.
 */
const TURN_GAP_CLASS = "pb-[var(--chat-turn-gap)] empty:pb-0";

/** Upstream's 20px row margin between consecutive user rows, such as prompts queued mid-turn. */
const USER_ROW_GAP_CLASS = "pb-[var(--chat-user-row-gap)] empty:pb-0";

/**
 * Upstream claude.ai/code opens every turn wrapper with a visually hidden
 * heading quoting the turn ("You said: ..." / "Claude responded: ..."), giving
 * screen readers a heading list to navigate the transcript turn by turn. It is
 * hidden from sight and from text selection, so copying a turn never picks it up.
 */
function TurnHeading({speaker, text}: {speaker: "user" | "assistant"; text: string}) {
	return <h2 className="sr-only select-none">{messageHeading(speaker, text)}</h2>;
}

/**
 * The row wrapper every user-side entry shares, heading included, so a new
 * entry variant cannot render a user turn without naming the speaker.
 */
function UserTurn({text, children}: {text: string; children: React.ReactNode}) {
	return (
		<div className="group/msg flex justify-end w-full">
			<TurnHeading speaker="user" text={text} />
			{children}
		</div>
	);
}

function LineEntry({
	line,
	nextLine,
	className,
	turnChanges,
	undoable = false,
	footer,
	precedesReply = false,
	precedesStatus = null,
	precedesPrompt = false,
	...renderProps
}: LineRenderProps & {
	line: SessionLine;
	nextLine: SessionLine | undefined;
	className?: string;
	/** An ordinary prompt whose reply row carries the boundary, so this row adds no turn gap. */
	precedesReply?: boolean;
	/** Prose whose own span continues into a row that opens with a status or a plain marker. */
	precedesStatus?: OpeningStatus | null;
	/** A prompt followed by another prompt row, which upstream spaces by its user row gap. */
	precedesPrompt?: boolean;
	/** The end-of-turn changes card this line closes, shown after its content. */
	turnChanges?: TurnChanges | undefined;
	/** Whether that card offers Undo: the session's last turn, unarchived. */
	undoable?: boolean;
	/** Undefined preserves Verbose record actions; null suppresses a non-endpoint footer. */
	footer?: React.ReactNode;
}) {
	const content = renderSessionMessage({
		line,
		...renderProps,
		nextLine,
	});

	const isAssistant = line.type === "assistant";
	const wrapperClassName = [
		isAssistant ? "group/msg flex flex-col w-full" : "group relative",
		precedesReply ? undefined : precedesPrompt ? USER_ROW_GAP_CLASS : TURN_GAP_CLASS,
		className,
	]
		.filter(Boolean)
		.join(" ");
	const wrapper = (
		<div
			key={`line-${line.lineIndex}`}
			data-record-index={line.lineIndex}
			data-precedes-turn-status={
				precedesStatus === null ? undefined : precedesStatus === "marker" ? "marker" : ""
			}
			className={wrapperClassName}
		/>
	);
	const children = (
		<>
			{line.type === "assistant" && <TurnHeading speaker="assistant" text={messageText(line)} />}
			{content}
			{turnChanges && (
				<TurnChangesCard sessionId={renderProps.sessionId} changes={turnChanges} undoable={undoable} />
			)}
			{isAssistant &&
				(footer === undefined ? (
					<AssistantTurnActions line={line} sessionId={renderProps.sessionId} />
				) : (
					footer
				))}
			{(isHookSystemMessageLine(line) || (line.type === "user" && line.isCompactSummary === true)) && footer}
		</>
	);
	if (line.type !== "assistant") return React.cloneElement(wrapper, undefined, children);
	return (
		<TranscriptMessageMenu
			speaker="assistant"
			sessionId={getSourceSessionId(line, renderProps.sessionId)}
			uuid={line.uuid}
			markdown={messageText(line)}
			render={wrapper}
		>
			{children}
		</TranscriptMessageMenu>
	);
}

/**
 * Hook returning a map of `tool_use_id` -> live failure info derived from
 * `PostToolUseFailure` SSE events for the given session. Empty when the
 * session has no in-flight failures or the JSONL has already caught up.
 */
function useLiveToolFailures(sessionId: string): Map<string, LiveToolFailure> {
	const {failedTools} = useClaudeEvents();
	return useMemo(() => {
		const map = new Map<string, LiveToolFailure>();
		for (const failed of failedTools.values()) {
			if (failed.sessionId !== sessionId) continue;
			if (!failed.toolUseId) continue;
			map.set(failed.toolUseId, {
				toolUseId: failed.toolUseId,
				error: failed.error,
			});
		}
		return map;
	}, [failedTools, sessionId]);
}

/** The tool_use blocks of one message line, built into renderable calls. */
function buildLineToolCalls(
	line: MessageSessionLine,
	toolResultMap: Map<string, ToolResultInfo>,
	liveFailures: Map<string, LiveToolFailure>,
	subagentLookup: SubagentLookup,
): ClientToolCall[] {
	const content = line.message?.content;
	if (!Array.isArray(content)) return [];
	const invalid = new Set(line.invalidToolInputIds);
	return content
		.filter((b): b is ToolUseBlock => b.type === "tool_use")
		.map((block) => {
			const call = buildClientToolCall(
				block,
				line.uuid ?? "",
				toolResultMap,
				liveFailures,
				subagentLookup,
				invalid.has(block.id),
			);
			return line.timestamp === undefined ? call : {...call, startedAt: line.timestamp};
		});
}

/** A run of tool calls sharing one source session, ready to summarize. */
interface ToolCallBatch {
	/** The run's first line: the row is anchored on it and carries its record index. */
	head: MessageSessionLine;
	sourceSessionId: string;
	calls: ClientToolCall[];
}

/**
 * A run of consecutive tool-only assistant messages, drawn as one turn so the
 * rows sit an item gap apart rather than a turn gap.
 *
 * The whole run collapses into one summary row, spanning tool types the way
 * upstream claude.ai/code Normal does: its group labels read "Ran 2 commands,
 * read cache.ts" and "Updated todos, read 3 files", merging calls issued across
 * several API messages (.llm/ui-sync/upstream/code-rich-normal.tree.json). No
 * information is lost -- every call keeps its own row inside the collapsed body.
 *
 * The one boundary that still splits a run is a change of source session: an
 * inlined subagent's rows carry their own session id, and a row's debug links
 * are resolved against the single session id passed down with it.
 */
function GroupedToolCallEntry({
	entries,
	notices,
	footer,
	turnChanges,
	undoable = false,
	sessionId,
	toolResultMap,
	subagentLookup,
}: {
	entries: SessionLine[];
	/** Background-task completions and agent messages folded into the run, shown with its last batch. */
	notices: readonly FoldedNotice[];
	footer?: React.ReactNode;
	turnChanges?: TurnChanges | undefined;
	/** Whether the card offers Undo: the session's last turn, unarchived. */
	undoable?: boolean;
	sessionId: string;
	toolResultMap: Map<string, ToolResultInfo>;
	subagentLookup: SubagentLookup;
}) {
	const liveFailures = useLiveToolFailures(sessionId);
	const opensReply = useContext(AssistantSpanEntryContext)?.opensReply === true;
	const verbose = useContext(TranscriptModeContext) === "verbose";
	const batches = useMemo(() => {
		const result: ToolCallBatch[] = [];
		let openBatch: ToolCallBatch | undefined;
		for (const line of entries) {
			if (line.type !== "assistant") continue;
			const calls = buildLineToolCalls(line, toolResultMap, liveFailures, subagentLookup);
			if (calls.length === 0) continue;
			const sourceSessionId = getSourceSessionId(line, sessionId);
			if (openBatch?.sourceSessionId === sourceSessionId) {
				openBatch.calls.push(...calls);
				continue;
			}
			openBatch = {head: line, sourceSessionId, calls};
			result.push(openBatch);
		}
		return result;
	}, [entries, sessionId, toolResultMap, liveFailures, subagentLookup]);

	const lastBatch = batches.at(-1);
	if (lastBatch === undefined)
		return notices.length === 0 ? null : <BackgroundNoticeRows notices={notices} footer={footer} />;

	// Upstream's 12px below a group is 16px less its TurnStatus outset. A lone Agent row has no
	// outset, so a group ending with one keeps its turn gap.
	const lastCalls = lastBatch.calls;
	const endsWithStatus = lastCalls.length !== 1 || notices.length > 0 || lastCalls[0]?.name !== "Agent";

	return (
		<div
			data-grouped-tool-row={turnChanges === undefined && endsWithStatus ? "" : undefined}
			className={`group/msg flex flex-col w-full ${TURN_GAP_CLASS}`}
		>
			<div className={`flex flex-col gap-[var(--chat-item-gap)] ${turnChanges ? TURN_GAP_CLASS : ""}`}>
				<TurnHeading speaker="assistant" text="" />
				{batches.map((batch, index) => (
					<TranscriptMessageMenu
						key={batch.head.lineIndex}
						speaker="assistant"
						sessionId={batch.sourceSessionId}
						uuid={batch.head.uuid}
						markdown=""
						render={<div data-record-index={batch.head.lineIndex} className="flex flex-col w-full" />}
					>
						<ToolCallSection
							calls={batch.calls}
							sessionId={batch.sourceSessionId}
							notices={index === batches.length - 1 ? notices : NO_NOTICES}
							leading={opensReply && index === 0}
						/>
					</TranscriptMessageMenu>
				))}
			</div>
			{verbose &&
				entries.map(
					(line) =>
						line.type === "assistant" &&
						line.requestRef !== undefined && (
							<ApiRequestDisclosure
								key={line.lineIndex}
								sessionId={getSourceSessionId(line, sessionId)}
								requestRef={line.requestRef}
							/>
						),
				)}
			{turnChanges && <TurnChangesCard sessionId={sessionId} changes={turnChanges} undoable={undoable} />}
			<div>{footer}</div>
		</div>
	);
}

/** A `<task-notification>` user turn folded into the tool group beside it. */
interface BackgroundNotice {
	kind: "task";
	lineIndex: number;
	notification: TaskNotification;
}

/** An agent message folded into the tool group it arrived before or among. */
interface PeerNotice {
	kind: "peer";
	lineIndex: number;
	message: AgentMessage;
	/** It arrived before the group's first tool call. */
	leads: boolean;
}

/** Stop-hook feedback that re-prompted Claude straight into the tool group after it. */
interface HookNotice {
	kind: "hook";
	lineIndex: number;
	line: MessageSessionLine;
}

type FoldedNotice = BackgroundNotice | PeerNotice | HookNotice;

const NO_NOTICES: readonly FoldedNotice[] = [];

/**
 * The agent message a meta user line delivers. One the turn absorbed as a
 * queued_command attachment never reaches upstream, so it is Verbose-only.
 */
function agentMessageOf(line: SessionLine): AgentMessage | null {
	if (line.type !== "user" || classifyUserContent(line) !== "agent-message") return null;
	return parseAgentMessage(getUserContentText(line));
}

function lineTimestamp(line: SessionLine): string | undefined {
	return "timestamp" in line ? line.timestamp : undefined;
}

/**
 * Whether the sender finished a slow foreground command after the parent's
 * last assistant record and before its message arrived. Upstream tracks such a
 * command as a task, and its events keep the hand-back out of the next tool run.
 */
function heldBySlowCommand(
	lines: readonly SessionLine[],
	index: number,
	sender: string,
	subagentLookup: SubagentLookup,
): boolean {
	const ends = subagentLookup.byBareId.get(sender)?.slowCommands;
	const arrived = lineTimestamp(defined(lines[index], "heldBySlowCommand index is in range"));
	if (ends === undefined || arrived === undefined) return false;
	let previous = index - 1;
	while (previous >= 0 && lines[previous]?.type !== "assistant") previous--;
	const parent = lines[previous];
	const parentSpoke = parent === undefined ? undefined : lineTimestamp(parent);
	const after = parentSpoke === undefined ? -Infinity : Date.parse(parentSpoke);
	const until = Date.parse(arrived);
	return ends.some(({finishedAt}) => {
		const at = Date.parse(finishedAt);
		return at > after && at <= until;
	});
}

/**
 * The agent message at `index` when upstream folds it into the tool run it
 * reaches: only when the next assistant record opens with a tool call. One
 * that opens with thinking, even empty, keeps the message as its own row, as
 * does one whose sender's slow command finished since the parent last spoke.
 */
function foldablePeerMessage(
	lines: readonly SessionLine[],
	index: number,
	subagentLookup: SubagentLookup,
): AgentMessage | null {
	const message = agentMessageOf(defined(lines[index], "foldablePeerMessage index is in range"));
	if (message === null || heldBySlowCommand(lines, index, message.from, subagentLookup)) return null;
	for (let next = index + 1; next < lines.length; next++) {
		const line = lines[next];
		if (line?.type !== "assistant") continue;
		const content = line.message?.content;
		return Array.isArray(content) && content[0]?.type === "tool_use" ? message : null;
	}
	return null;
}

/** Each subagent an Agent call in this transcript launched, by agent id, to its description. */
function launchedAgentDescriptions(
	lines: readonly SessionLine[],
	toolResultMap: ReadonlyMap<string, ToolResultInfo>,
): ReadonlyMap<string, string> {
	const descriptions = new Map<string, string>();
	for (const line of lines) {
		if (line.type !== "assistant" || !Array.isArray(line.message?.content)) continue;
		for (const block of line.message.content) {
			if (block.type !== "tool_use" || (block.name !== "Agent" && block.name !== "Task")) continue;
			const description: unknown = block.input["description"];
			const agentId = toolResultMap.get(block.id)?.resultMeta?.agentId;
			if (typeof description === "string" && description !== "" && agentId !== undefined) {
				descriptions.set(agentId, description);
			}
		}
	}
	return descriptions;
}

function transcriptToolUseIds(lines: readonly SessionLine[]): Set<string> {
	const ids = new Set<string>();
	for (const line of lines) {
		if (line.type !== "assistant" || !Array.isArray(line.message?.content)) continue;
		for (const block of line.message.content) if (block.type === "tool_use") ids.add(block.id);
	}
	return ids;
}

/**
 * Completed notifications upstream never draws, all queued mid-turn: a
 * background Agent settles on its own "Ran agent" row, and a task launched in
 * this transcript was already dropped when it started beside its own launch.
 * One that opens a turn as a user record still draws (an agent's as its
 * completion row).
 */
function settledCompletionIndices(lines: readonly SessionLine[]): number[] {
	let launches: Set<string> | null = null;
	return lines.flatMap((line, index) => {
		const notification = taskNotificationOf(line);
		if (notification?.status !== "completed" || line.type !== "attachment") return [];
		if (notification.agent) return [index];
		if (notification.toolUseId === null) return [];
		launches ??= transcriptToolUseIds(lines);
		return launches.has(notification.toolUseId) ? [index] : [];
	});
}

/**
 * The completed background Agent a user record's notification reports, which
 * upstream draws as "<done description> · took Ns" with no bubble.
 */
function agentCompletionOf(line: SessionLine): TaskNotification | null {
	if (line.type !== "user") return null;
	const notification = taskNotificationOf(line);
	return notification?.status === "completed" && notification.agent ? notification : null;
}

/**
 * Completed background Agents upstream draws above their own launch, keyed by
 * the launching line's index: a user-record completion whose agent sent no
 * hand-back between its launch and the notification (79a0ad58:153). Upstream
 * shows the task as started there and completes that row in place; after a
 * hand-back (5f402159:2172) it drops the started row and draws the completion
 * where the notification arrived.
 */
function hoistedAgentCompletions(
	lines: readonly SessionLine[],
): Map<number, {index: number; completion: TaskNotification}> {
	const hoisted = new Map<number, {index: number; completion: TaskNotification}>();
	let launches: Map<string, number> | null = null;
	for (const [index, line] of lines.entries()) {
		const completion = agentCompletionOf(line);
		if (completion?.toolUseId == null) continue;
		launches ??= new Map(
			lines.flatMap((candidate, candidateIndex) =>
				candidate.type === "assistant" && Array.isArray(candidate.message?.content)
					? candidate.message.content.flatMap((block) =>
							block.type === "tool_use" ? [[block.id, candidateIndex] as const] : [],
						)
					: [],
			),
		);
		const launch = launches.get(completion.toolUseId);
		if (launch === undefined || launch > index) continue;
		const handedBack = lines
			.slice(launch + 1, index)
			.some((between) => agentMessageOf(between)?.from === completion.taskId);
		if (!handedBack) hoisted.set(launch, {index, completion});
	}
	return hoisted;
}

/** The description a user line's plain-text "Background agent ... was stopped" notice names. */
function stoppedAgentNoticeOf(line: SessionLine): string | null {
	return line.type === "user" ? stoppedAgentDescription(getUserContentText(line)) : null;
}

/**
 * The record index of the status row a stopped-agent notice draws just before
 * its own bubble, between the two so each keeps its own transcript row.
 */
function stoppedStatusIndex(line: SessionLine): number {
	return line.lineIndex - 0.5;
}

/**
 * The finished background task a line announces, or null for any other line.
 * A notification queued while the turn ran arrives as a queued_command
 * attachment instead of a user line.
 */
function taskNotificationOf(line: SessionLine): TaskNotification | null {
	if (line.type === "attachment") {
		const {type, prompt} = getAttachmentHead(line.attachmentJson);
		return type === "queued_command" && prompt !== null ? parseTaskNotification(prompt) : null;
	}
	if (line.type !== "user") return null;
	return parseTaskNotification(getUserContentText(line));
}

/** How a background launch ended when it did not complete, keyed by the launching tool_use id. */
type BackgroundOutcome = "failed" | "stopped";

interface BackgroundOutcomes {
	byLaunch: ReadonlyMap<string, BackgroundOutcome>;
	/** The launch each successful TaskStop ended, keyed by the TaskStop's tool_use id. */
	stoppedBy: ReadonlyMap<string, string>;
}

const BackgroundOutcomeContext = createContext<BackgroundOutcomes>({byLaunch: new Map(), stoppedBy: new Map()});

/** The tool_use id the session's permission prompt waits on, if any. */
const PermissionWaitContext = createContext<string | null>(null);

/** The call as its running label reads it: flagged when the permission prompt holds it. */
function withPermissionWait<Call extends {id: string}>(
	call: Call,
	waitingId: string | null,
): Call & {awaitingPermission?: true} {
	return call.id === waitingId ? {...call, awaitingPermission: true} : call;
}

const BACKGROUND_LAUNCH_ID = /running in background with ID: (\S+?)\.?(?:\s|$)/;
const TASK_STOPPERS = new Set(["TaskStop", "KillShell"]);

/** The background task id a `run_in_background` Bash call's result reports. */
function backgroundLaunchTaskId(
	block: ToolUseBlock,
	toolResultMap: ReadonlyMap<string, ToolResultInfo>,
): string | null {
	if (block.name !== "Bash" || block.input["run_in_background"] !== true) return null;
	const info = toolResultMap.get(block.id);
	if (info === undefined || info.isError) return null;
	return BACKGROUND_LAUNCH_ID.exec(info.result)?.[1] ?? null;
}

/** The task id a successful TaskStop (or older KillShell) call stopped. */
function stoppedTaskId(block: ToolUseBlock, toolResultMap: ReadonlyMap<string, ToolResultInfo>): string | null {
	if (!TASK_STOPPERS.has(block.name)) return null;
	const info = toolResultMap.get(block.id);
	if (info === undefined || info.isError) return null;
	const taskId = block.input["task_id"] ?? block.input["shell_id"];
	return typeof taskId === "string" ? taskId : null;
}

/**
 * The failed or stopped outcome each `<task-notification>` reports for the call
 * that launched it, so upstream's launch row can carry the status. A launch no
 * notification settles is stopped by the TaskStop that ended it, which upstream
 * also folds into that TaskStop's group as a stopped background task.
 */
function backgroundLaunchOutcomes(
	lines: readonly SessionLine[],
	toolResultMap: ReadonlyMap<string, ToolResultInfo>,
): BackgroundOutcomes {
	const byLaunch = new Map<string, BackgroundOutcome>();
	const notified = new Set<string>();
	const launchByTaskId = new Map<string, string>();
	const stops: {stopId: string; taskId: string}[] = [];
	for (const line of lines) {
		const notification = taskNotificationOf(line);
		if (notification !== null && notification.toolUseId !== null) {
			notified.add(notification.toolUseId);
			if (notification.status !== "completed") byLaunch.set(notification.toolUseId, notification.status);
		}
		const content = line.type === "assistant" ? line.message?.content : undefined;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block.type !== "tool_use") continue;
			const launched = backgroundLaunchTaskId(block, toolResultMap);
			if (launched !== null) launchByTaskId.set(launched, block.id);
			const stopped = stoppedTaskId(block, toolResultMap);
			if (stopped !== null) stops.push({stopId: block.id, taskId: stopped});
		}
	}
	const stoppedBy = new Map<string, string>();
	for (const {stopId, taskId} of stops) {
		const launch = launchByTaskId.get(taskId);
		if (launch === undefined || notified.has(launch)) continue;
		byLaunch.set(launch, "stopped");
		stoppedBy.set(stopId, launch);
	}
	return {byLaunch, stoppedBy};
}

function failedLaunchIds({byLaunch}: BackgroundOutcomes): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const [id, outcome] of byLaunch) if (outcome === "failed") ids.add(id);
	return ids;
}

/** The stopped background tasks the group's TaskStop calls ended, as upstream folds them in. */
function stopCompletions(
	calls: readonly ClientToolCall[],
	{stoppedBy}: BackgroundOutcomes,
): BackgroundCompletionLike[] {
	return calls.flatMap((call) => {
		const launch = stoppedBy.get(call.id);
		return launch === undefined ? [] : [{command: false, status: "stopped", toolUseId: launch}];
	});
}

/**
 * Upstream's static group sub-row: a muted "Background command" (or "task"), the
 * description in primary ink, and a danger "Failed" or secondary "Stopped" when
 * the task did not complete.
 */
function BackgroundNoticeRow({notice}: {notice: BackgroundNotice}) {
	const {status, description, command} = notice.notification;
	return (
		<div
			data-record-index={notice.lineIndex}
			data-background-notice=""
			className="flex min-w-0 items-center gap-1.5 text-body"
		>
			<span className="shrink-0 text-ink-muted">{command ? "Background command" : "Background task"}</span>
			{description !== "" && <span className="truncate min-w-0 text-primary">{description}</span>}
			{status === "failed" && <span className="shrink-0 text-danger-ink">Failed</span>}
			{status === "stopped" && <span className="shrink-0 text-secondary">Stopped</span>}
		</div>
	);
}

function splitNotices(notices: readonly FoldedNotice[]): {
	taskNotices: BackgroundNotice[];
	leadingPeers: PeerNotice[];
	trailingPeers: PeerNotice[];
	hooks: HookNotice[];
} {
	const taskNotices: BackgroundNotice[] = [];
	const leadingPeers: PeerNotice[] = [];
	const trailingPeers: PeerNotice[] = [];
	const hooks: HookNotice[] = [];
	for (const notice of notices) {
		if (notice.kind === "task") taskNotices.push(notice);
		else if (notice.kind === "hook") hooks.push(notice);
		else (notice.leads ? leadingPeers : trailingPeers).push(notice);
	}
	return {taskNotices, leadingPeers, trailingPeers, hooks};
}

function FoldedNoticeRow({notice}: {notice: FoldedNotice}) {
	switch (notice.kind) {
		case "task":
			return <BackgroundNoticeRow notice={notice} />;
		case "peer":
			return <AgentMessageRow message={notice.message} />;
		case "hook":
			return <StopHookMarker line={notice.line} />;
		default:
			return assertNever(notice);
	}
}

/**
 * Upstream's task-event row: a plain 20px status line in secondary ink with
 * no disclosure, "Background task stopped · <description>" or an agent's
 * "<done description> · took 27s".
 */
function TaskEventStatusRow({
	label,
	detail,
	footer,
}: {
	label: React.ReactNode;
	detail: string | null;
	footer: React.ReactNode;
}) {
	return (
		<div
			data-task-event-row=""
			className="group/msg flex flex-col w-full pb-4 has-[>[data-assistant-span-footer]]:pb-[var(--chat-turn-gap)] [&>[data-assistant-span-footer]]:mt-[5px]"
		>
			<TurnStatusFrame leading={false}>
				<div data-turn-status="" className={TURN_STATUS_CLASS}>
					<div data-turn-status-marker="" className="flex min-w-0 gap-1 me-[52px] px-1">
						<span className="text-body shrink-0 text-secondary">{label}</span>
						{detail !== null && (
							<>
								{" "}
								<span className="text-body min-w-0 truncate text-secondary">· {detail}</span>
							</>
						)}
					</div>
				</div>
			</TurnStatusFrame>
			{footer}
		</div>
	);
}

interface UndeliveredRow {
	label: React.ReactNode;
	detail: string | null;
}

/**
 * The task-event row each slot of undelivered `<task-notification>`s draws, keyed by the slot's
 * first index in `lines`. Upstream draws a completed command and a stopped task, one alone as its
 * own row and two or more in a row as one summary row; only a line that renders ends the run. A
 * task launched in this transcript already settles on its own launch row.
 */
function undeliveredTaskRows(
	lines: readonly SessionLine[],
	renders: (index: number) => boolean,
): Map<number, UndeliveredRow> {
	const rows = new Map<number, UndeliveredRow>();
	let launches: Set<string> | null = null;
	let slot: Array<{index: number; label: string; notification: TaskNotification}> = [];
	const flush = () => {
		const [first] = slot;
		if (first !== undefined) {
			rows.set(
				first.index,
				slot.length === 1
					? {label: first.label, detail: first.notification.description}
					: {
							label: <NoticeSummary entries={slot.map(({notification}) => noticeEntry(notification))} />,
							detail: null,
						},
			);
		}
		slot = [];
	};
	for (const [index, line] of lines.entries()) {
		if (line.type !== "queued-task-notification") {
			if (renders(index)) flush();
			continue;
		}
		const notification = parseTaskNotification(line.content);
		if (notification === null) continue;
		const label =
			notification.status === "stopped"
				? "Background task stopped"
				: notification.status === "completed" && notification.command
					? "Background command completed"
					: null;
		if (label === null) continue;
		launches ??= transcriptToolUseIds(lines);
		if (notification.toolUseId !== null && launches.has(notification.toolUseId)) continue;
		slot.push({index, label, notification});
	}
	flush();
	return rows;
}

function noticeEntry(notification: TaskNotification): NoticeEntry {
	return {
		status: notification.status,
		kind: notification.command ? "shell" : notification.agent ? "agent" : "task",
	};
}

/** Upstream's summary row text: one span per part, joined by ", ", with failed in danger ink. */
function NoticeSummary({entries}: {entries: readonly NoticeEntry[]}) {
	return backgroundNoticeSummary(entries).map((part, index) => (
		<React.Fragment key={part.key}>
			{index > 0 && ", "}
			<span className={part.danger ? "text-danger-ink" : undefined}>{part.text}</span>
		</React.Fragment>
	));
}

/** A completed background Agent's "<done description> · took Ns" task-event row. */
function AgentCompletionRow({completion, footer}: {completion: TaskNotification; footer: React.ReactNode}) {
	return (
		<TaskEventStatusRow
			label={pastTense(completion.description)}
			detail={
				completion.durationMs === null
					? null
					: `took ${formatElapsed(Math.round(completion.durationMs / 1000))}`
			}
			footer={footer}
		/>
	);
}

/** Notifications with no tool group to join, drawn as the same static rows. */
function BackgroundNoticeRows({notices, footer}: {notices: readonly FoldedNotice[]; footer?: React.ReactNode}) {
	return (
		<div className={`flex flex-col w-full gap-[var(--chat-item-gap)] ${TURN_GAP_CLASS}`}>
			{notices.map((notice) => (
				<FoldedNoticeRow key={notice.lineIndex} notice={notice} />
			))}
			{footer}
		</div>
	);
}

/**
 * The session metadata upstream claude.ai/code folds into one collapsed
 * "Initialized session" disclosure at the head of a transcript. Only the
 * leading run folds -- a worktree switch mid-session is news, not setup.
 */
const SESSION_INIT_LINE_TYPES = new Set(["agent-name", "agent-color", "permission-mode", "worktree"]);

/**
 * Upstream's collapsed transcript marker row: a bare disclosure button with a
 * truncating primary label and a secondary chevron.
 */
function MarkerDisclosureButton({
	label,
	expanded,
	bodyId,
	onToggle,
}: {
	label: string;
	expanded: boolean;
	bodyId: string;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-expanded={expanded}
			aria-controls={bodyId}
			onClick={onToggle}
			className="flex self-start max-w-full items-center gap-g2 text-left outline-none hide-focus-ring focus-visible:ring-focus rounded-r3"
		>
			<span className="text-body min-w-0 truncate text-primary">{label}</span>
			<span className="shrink-0 text-secondary">
				<ChevronIcon expanded={expanded} size={14} />
			</span>
		</button>
	);
}

/**
 * A transcript whose first records carry another session's id was carried
 * over from an earlier session, which upstream heads "Resumed session".
 */
function isResumedTranscript(lines: SessionLine[], renderProps: LineRenderProps): boolean {
	if (renderProps.isSubagentSession) return false;
	const first = lines.find((line) => "sessionId" in line && line.sessionId !== undefined);
	return first !== undefined && "sessionId" in first && first.sessionId !== renderProps.sessionId;
}

/** Upstream's session head marker, holding the individual metadata banners as its body. */
function SessionInitEntry({
	lines,
	indices,
	resumed,
	...renderProps
}: LineRenderProps & {
	lines: SessionLine[];
	indices: number[];
	resumed: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const bodyId = useId();

	return (
		<div className={`flex flex-col w-full ${TURN_GAP_CLASS}`}>
			<MarkerDisclosureButton
				label={resumed ? "Resumed session" : "Initialized session"}
				expanded={expanded}
				bodyId={bodyId}
				onToggle={() => {
					setExpanded(!expanded);
				}}
			/>
			{expanded && (
				<div id={bodyId} className="flow-root">
					<div className="flex flex-col pt-p6">
						{indices.map((index) => (
							<LineEntry
								key={`line-${index}`}
								line={defined(lines[index], "initialization group index is in range")}
								nextLine={lines[index + 1]}
								{...renderProps}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

const BANNER_LINE_TYPES = new Set([
	"agent-name",
	"agent-color",
	"permission-mode",
	"artifact-link",
	"artifact-watch",
	"attachment",
	"system",
	"worktree",
]);

/**
 * Text, or narration (Claude Code's user-facing prose in a thinking block), that
 * draws as assistant prose. Upstream closes a tool run at either.
 */
function isAssistantProseBlock(block: SessionContentBlock): boolean {
	if (block.type === "text") return typeof block.text === "string" && block.text.trim() !== "";
	return narrationProse(block) !== null;
}

function toolBucketOf(block: ToolUseBlock, toolResultMap: ReadonlyMap<string, ToolResultInfo>): ToolBucket {
	const info = toolResultMap.get(block.id);
	return toolBucket({
		name: block.name,
		input: block.input,
		result: info?.result,
		isError: info?.isError,
		pending: info === undefined,
	});
}

/**
 * A tool-only line that may join a tool run. A standalone call (upstream's `toolBucket`) is
 * always its own run, so its line never groups and draws as a lone row or card.
 */
function isGroupableToolOnlyAssistantLine(
	line: SessionLine,
	toolResultMap: ReadonlyMap<string, ToolResultInfo>,
): boolean {
	const buckets = toolOnlyBuckets(line, toolResultMap);
	return buckets?.every((bucket) => bucket === "default") === true;
}

/** A tool-only line holding a standalone call, which draws as its own row and never joins a run. */
function isStandaloneToolOnlyAssistantLine(
	line: SessionLine,
	toolResultMap: ReadonlyMap<string, ToolResultInfo>,
): boolean {
	return toolOnlyBuckets(line, toolResultMap)?.includes("standalone") === true;
}

/** The bucket of each call on a line of only tool calls and hidden blocks, else null. */
function toolOnlyBuckets(line: SessionLine, toolResultMap: ReadonlyMap<string, ToolResultInfo>): ToolBucket[] | null {
	if (line.type !== "assistant") return null;
	const content = line.message?.content;
	if (!Array.isArray(content) || content.length === 0) return null;
	const buckets: ToolBucket[] = [];
	for (const b of content) {
		if (b.type === "tool_use") buckets.push(toolBucketOf(b, toolResultMap));
		else if (
			!((b.type === "text" && !isAssistantProseBlock(b)) || (b.type === "thinking" && b.thinking.trim() === ""))
		)
			return null;
	}
	return buckets;
}

/** An assistant line drawn as prose alone: visible text and no tool calls. */
function isProseOnlyAssistantLine(line: SessionLine): boolean {
	if (line.type !== "assistant" || transcriptRowKind(line) !== "assistant_text") return false;
	const content = line.message?.content;
	return !Array.isArray(content) || content.every((b) => b.type !== "tool_use");
}

/** The names of the calls ToolCallSection draws as rows rather than prominent cards. */
function backgroundToolNames(
	lines: readonly SessionLine[],
	toolResultMap: ReadonlyMap<string, ToolResultInfo>,
): string[] {
	return lines.flatMap((line) => {
		const content = line.type === "assistant" ? line.message?.content : undefined;
		if (!Array.isArray(content)) return [];
		return content.flatMap((b) =>
			b.type === "tool_use" && !isProminentCall({...toolResultMap.get(b.id), name: b.name, input: b.input})
				? [b.name]
				: [],
		);
	});
}

/** Whether ToolCallSection, given its row calls and notices, draws a TurnStatus first. */
function toolSectionOpensWithStatus(background: readonly string[], noticeCount: number): boolean {
	if (background.length === 0 && noticeCount === 0) return false;
	// A lone Agent row navigates rather than disclosing a status.
	if (background.length === 1 && noticeCount === 0) return background[0] !== "Agent";
	return true;
}

function isToolResultOnlyUserLine(line: SessionLine): boolean {
	if (line.type !== "user") return false;
	const content = line.message?.content;
	if (!Array.isArray(content) || content.length === 0) return false;
	return content.every((b) => b.type === "tool_result");
}

/** Upstream claude.ai/code's `data-perf-row` value on each `[data-testid=transcript-row]`. */
type TranscriptRowKind = "human" | "assistant_text" | "assistant_tool" | "assistant_thinking" | "assistant" | "marker";

/** The upstream row type for a single line drawn as its own transcript row. */
function transcriptRowKind(line: SessionLine): TranscriptRowKind {
	if (line.type === "user") return "human";
	if (isHookSystemMessageLine(line)) return "assistant_text";
	if (line.type !== "assistant") return "marker";
	const content = line.message?.content;
	if (!Array.isArray(content))
		return typeof content === "string" && content.trim() !== "" ? "assistant_text" : "assistant";
	if (content.some(isAssistantProseBlock)) return "assistant_text";
	if (content.some((b) => b.type === "tool_use")) return "assistant_tool";
	if (content.some((b) => b.type === "thinking")) return "assistant_thinking";
	return "assistant";
}

interface SessionListEntry {
	key: string;
	startRecordIndex: number;
	endRecordIndex: number;
	/** A user prompt, a stop for ⌥⌘↑ / ⌥⌘↓. */
	isPrompt: boolean;
	kind: TranscriptRowKind;
	assistantSpan?: AssistantDisplaySpan | undefined;
	/**
	 * The first rendered row of the reply to an ordinary prompt. Upstream opens
	 * that reply 6px below the prompt's action row with a margin inside the
	 * reply's own transcript row, in place of the prompt's turn gap.
	 */
	opensReply: boolean;
	element: React.ReactNode;
}

/** A row under construction, before its rendered neighbours are known. */
interface PendingSessionListEntry extends Omit<SessionListEntry, "endRecordIndex" | "opensReply"> {
	/** The assistant line a reply row starts with. */
	replyHead?: SessionLine;
	/** An ordinary prompt row, rendered once it is known whether its reply follows it. */
	prompt?: {
		line: SessionLine;
		render: (
			precedesReply: boolean,
			precedesStatus?: OpeningStatus | null,
			precedesPrompt?: boolean,
		) => React.ReactNode;
	};
	/** A prose row, rendered once it is known whether a status in its span follows it. */
	prose?: {render: (precedesStatus: OpeningStatus) => React.ReactNode};
	/** A row whose first drawn block is a TurnStatus disclosure, or a plain status marker. */
	opensWithStatus?: OpeningStatus;
}

/**
 * What a row opens with: a tool status, which upstream outsets 4px into the
 * prose gap above it, or a plain marker (a compaction, a task event), which it
 * does not.
 */
type OpeningStatus = "status" | "marker";

const PROMPT_KINDS: ReadonlySet<UserContentKind> = new Set(["text", "command", "bash"]);

function isPromptLine(line: SessionLine): boolean {
	return line.type === "user" && PROMPT_KINDS.has(classifyUserContent(line));
}

const ORDINARY_PROMPT_KINDS: ReadonlySet<UserContentKind> = new Set(["text", "command"]);

/** A typed prompt or slash command drawn as the user's own bubble, not a bash, label or subagent row. */
function isOrdinaryPromptLine(line: SessionLine, renderProps: LineRenderProps): boolean {
	return (
		line.type === "user" &&
		!renderProps.isSubagentSession &&
		line.isCompactSummary !== true &&
		ORDINARY_PROMPT_KINDS.has(classifyUserContent(line))
	);
}

/** Height of the sticky session header that covers the top of the scroller. */
function stickyHeaderInset(scroller: Element): number {
	return scroller.querySelector("[data-transcript-sticky-header]")?.getBoundingClientRect().height ?? 0;
}

interface VirtualRange {
	startIndex: number;
	endIndex: number;
}

export const ESTIMATED_TURN_HEIGHT_PIXELS = 320;
export const TRANSCRIPT_OVERSCAN_PIXELS = 320;
export const INITIAL_MOUNTED_TURN_COUNT = 8;

/** The summed height of the entries before `index`; callers stay within 0..entries.length. */
function prefixHeightAt(prefixHeights: readonly number[], index: number): number {
	return defined(prefixHeights[index], "prefix height index is in range");
}

function entryIndexAtOffset(prefixHeights: readonly number[], offset: number): number {
	let lower = 0;
	let upper = prefixHeights.length - 1;
	while (lower < upper) {
		const middle = Math.floor((lower + upper + 1) / 2);
		if (prefixHeightAt(prefixHeights, middle) <= offset) lower = middle;
		else upper = middle - 1;
	}
	return Math.min(lower, prefixHeights.length - 2);
}

function rangeForViewport(prefixHeights: readonly number[], viewportStart: number, viewportEnd: number): VirtualRange {
	const lastEntryIndex = prefixHeights.length - 2;
	if (lastEntryIndex < 0) return {startIndex: 0, endIndex: 0};
	const startOffset = Math.max(0, viewportStart - TRANSCRIPT_OVERSCAN_PIXELS);
	const endOffset = viewportEnd + TRANSCRIPT_OVERSCAN_PIXELS;
	return {
		startIndex: entryIndexAtOffset(prefixHeights, startOffset),
		endIndex: Math.min(lastEntryIndex + 1, entryIndexAtOffset(prefixHeights, endOffset) + 1),
	};
}

/**
 * How many rows an earlier page put ahead of the window starting at `startIndex`: the
 * first committed row from there that survives into `next` gives the offset.
 */
function prependedRowCount(
	committed: readonly SessionListEntry[],
	next: readonly SessionListEntry[],
	startIndex: number,
): number {
	const nextIndex = new Map(next.map((entry, index) => [entry.key, index]));
	for (let index = startIndex; index < committed.length; index++) {
		const moved = nextIndex.get(defined(committed[index], "committed index is in range").key);
		if (moved !== undefined) return moved - index;
	}
	return 0;
}

/** The reader's place: a painted row and its offset within the scroller's content. */
interface ScrollAnchor {
	entryKey: string;
	contentTop: number;
}

function mountedRowFor(list: Element, entries: readonly SessionListEntry[], key: string): HTMLElement | undefined {
	for (const row of list.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")) {
		if (entries[Number(row.dataset["transcriptEntryIndex"])]?.key === key) return row;
	}
	return undefined;
}

function firstPaintedRow(
	list: Element,
	scroller: Element,
	viewport: {top: number; height: number},
	entries: readonly SessionListEntry[],
	survives: (key: string) => boolean = () => true,
): ScrollAnchor | null {
	const {scrollTop} = scrollMetrics(scroller);
	for (const row of list.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")) {
		const rect = row.getBoundingClientRect();
		if (rect.bottom <= viewport.top) continue;
		if (rect.top >= viewport.top + viewport.height) return null;
		const entry = entries[Number(row.dataset["transcriptEntryIndex"])];
		if (!entry) return null;
		// A page landing above can regroup the record at its seam under a new key.
		if (!survives(entry.key)) continue;
		return {entryKey: entry.key, contentTop: rect.top - viewport.top + scrollTop};
	}
	return null;
}

function scrollerViewport(scroller: Element): {top: number; height: number} {
	if (scroller === document.documentElement || scroller === document.scrollingElement) {
		return {top: 0, height: window.innerHeight};
	}
	const rect = scroller.getBoundingClientRect();
	return {top: rect.top, height: scroller.clientHeight || rect.height || window.innerHeight};
}

/**
 * Upstream draws a prompt the user queued mid-turn exactly like a typed one, at
 * the point the turn took it in, so it ends the assistant turn there, stamped
 * with the time it was typed. A prompt the CLI later also wrote as a user record
 * keeps only that record.
 */
function withQueuedPrompts(lines: SessionLine[]): SessionLine[] {
	let result: SessionLine[] | null = null;
	let laterPrompts: Map<string, number> | null = null;
	for (const [index, line] of lines.entries()) {
		if (line.type !== "attachment" || line.humanPrompt === undefined) continue;
		const {content, timestamp = line.timestamp} = line.humanPrompt;
		const prompt: MessageSessionLine = {
			type: "user",
			message: {role: "user", content},
			lineIndex: line.lineIndex,
			...(line.uuid === undefined ? {} : {uuid: line.uuid}),
			...(timestamp === undefined ? {} : {timestamp}),
			...(line.sessionId === undefined ? {} : {sessionId: line.sessionId}),
		};
		laterPrompts ??= new Map(
			lines.flatMap((other, otherIndex) =>
				other.type === "user" ? [[getUserContentText(other), otherIndex] as const] : [],
			),
		);
		if ((laterPrompts.get(getUserContentText(prompt)) ?? -1) > index) continue;
		result ??= [...lines];
		result[index] = prompt;
	}
	return result ?? lines;
}

/**
 * Upstream draws a local command's output that the CLI logged as a system
 * record ("Kept model as `Fable 5.1`", "Diff panel shown") as assistant prose
 * in the reply it follows, so outside Verbose each non-empty one reads as an
 * assistant text line; the user-record stdout stays hidden.
 */
function withLocalCommandProse(lines: SessionLine[]): SessionLine[] {
	let result: SessionLine[] | null = null;
	for (const [index, line] of lines.entries()) {
		if (line.type !== "system" || line.subtype !== "local_command") continue;
		const output = localCommandOutput(line.content);
		if (output === "") continue;
		result ??= [...lines];
		result[index] = {
			type: "assistant",
			message: {role: "assistant", content: [{type: "text", text: output}]},
			lineIndex: line.lineIndex,
			...(line.uuid === undefined ? {} : {uuid: line.uuid}),
			...(line.timestamp === undefined ? {} : {timestamp: line.timestamp}),
			...(line.sessionId === undefined ? {} : {sessionId: line.sessionId}),
		};
	}
	return result ?? lines;
}

/** The row id of each prompt waiting in the CLI's queue, as the transcript tail draws it. */
function queuedEntryIds(lines: SessionLine[]): string[] {
	return lines.flatMap((line) => (line.type === "queued-prompt" ? [queuedEntryId(line.lineIndex)] : []));
}

const queuedEntryId = (lineIndex: number): string => `queued-${lineIndex}`;

/**
 * A prompt waiting in the CLI's queue is read after everything already written, so it sits after
 * the last other line, in enqueue order. Once the CLI is gone nothing will read it, so it is dropped.
 */
function withQueuedPromptsAtTail(lines: SessionLine[], sessionLive: boolean): SessionLine[] {
	if (!lines.some((line) => line.type === "queued-prompt")) return lines;
	const others = lines.filter((line) => line.type !== "queued-prompt");
	return sessionLive ? [...others, ...lines.filter((line) => line.type === "queued-prompt")] : others;
}

/**
 * The CLI writes a queued `<task-notification>`'s enqueue line before an assistant record it
 * flushes later, so file order would draw the notification above text that came first. Upstream
 * places it by its enqueue time: after the last line timestamped at or before it. Walking from the
 * end keeps a run of notifications in order, since none moves past the next one.
 */
function withNotificationsAtEnqueueTime(lines: SessionLine[]): SessionLine[] {
	let result: SessionLine[] | null = null;
	for (let index = lines.length - 1; index >= 0; index--) {
		const line = defined(lines[index], "session line index is in range");
		if (line.type !== "queued-task-notification" || line.timestamp === undefined) continue;
		const enqueuedAt = Date.parse(line.timestamp);
		const current: SessionLine[] = result ?? lines;
		let target = index;
		for (let next = index + 1; next < current.length; next++) {
			const later = defined(current[next], "session line index is in range");
			if (later.type === "queued-task-notification") break;
			const laterAt = lineTimestamp(later);
			if (laterAt === undefined) continue;
			if (Date.parse(laterAt) > enqueuedAt) break;
			target = next;
		}
		if (target === index) continue;
		result ??= [...lines];
		result.splice(index, 1);
		result.splice(target, 0, line);
	}
	return result ?? lines;
}

/**
 * Upstream tracks a subagent's slow foreground command as a task of its own
 * and folds its completion into the tool run open when it finishes, or into
 * the next one when the parent is idle or talking: 6473581f reads "Ran 2
 * commands, finished 8 background commands" for a notification plus the seven
 * slow commands a teammate ran while the parent waited.
 */
class SlowCommandAbsorber {
	private readonly commands: SlowCommand[];
	private next = 0;

	constructor(subagentLookup: SubagentLookup) {
		this.commands = [...subagentLookup.byBareId.values()]
			.flatMap((agent) => agent.slowCommands ?? [])
			.toSorted((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));
	}

	/**
	 * The completions of the commands that finished after `since` and by the
	 * group's last record. Any finished earlier stood alone upstream, which
	 * draws nothing for them.
	 */
	absorbInto(groupLines: readonly SessionLine[], since: number): BackgroundNotice[] {
		const last = groupLines.at(-1);
		const end = Math.max(
			...groupLines.flatMap((line) => {
				const at = lineTimestamp(line);
				return at === undefined ? [] : [Date.parse(at)];
			}),
		);
		if (last === undefined || !Number.isFinite(end)) return [];
		return this.take(since, end).map((command) => ({
			kind: "task",
			lineIndex: last.lineIndex,
			notification: slowCommandCompletion(command),
		}));
	}

	/**
	 * The commands that finished after `since` and by `until`, consuming every
	 * one finished by `until`: those before `since` finished while the parent
	 * talked, which upstream draws nothing for.
	 */
	take(since: number, until: number): SlowCommand[] {
		const taken: SlowCommand[] = [];
		for (let command = this.commands[this.next]; command !== undefined; command = this.commands[this.next]) {
			const finishedAt = Date.parse(command.finishedAt);
			if (finishedAt > until) break;
			this.next++;
			if (finishedAt > since) taken.push(command);
		}
		return taken;
	}
}

function slowCommandCompletion(command: SlowCommand): TaskNotification {
	return {
		taskId: null,
		toolUseId: null,
		status: command.status,
		command: true,
		agent: false,
		description: command.description,
		durationMs: null,
	};
}

/**
 * The row upstream draws for the slow commands a subagent finished while the
 * parent idled between turns: "Background command completed · <description>"
 * for one, "N background commands completed, 1 failed" for several.
 */
function IdleCommandsRow({commands}: {commands: readonly SlowCommand[]}) {
	const [first] = commands;
	return commands.length === 1 && first !== undefined ? (
		<TaskEventStatusRow label={`Background command ${first.status}`} detail={first.description} footer={null} />
	) : (
		<TaskEventStatusRow
			label={<NoticeSummary entries={commands.map(({status}) => ({status, kind: "shell"}))} />}
			detail={null}
			footer={null}
		/>
	);
}

/** A line that opens a parent turn: a prompt, hand-back or notification rather than a tool result. */
function opensTurn(line: SessionLine): boolean {
	return (line.type === "user" && !isToolResultOnlyUserLine(line)) || line.type === "queued-task-notification";
}

/**
 * Whether the line is the tool result answering an AskUserQuestion: the parent
 * idled while it waited for the answer, as it does between turns.
 */
function answersQuestion(lines: readonly SessionLine[], index: number): boolean {
	const line = defined(lines[index], "session line index is in range");
	if (line.type !== "user" || !isToolResultOnlyUserLine(line)) return false;
	const content = line.message?.content;
	const answered = new Set(
		Array.isArray(content)
			? content.flatMap((block) => (block.type === "tool_result" ? [block.tool_use_id] : []))
			: [],
	);
	for (let previous = index - 1; previous >= 0; previous--) {
		const asked = defined(lines[previous], "session line index is in range");
		const blocks = asked.type === "assistant" ? asked.message?.content : undefined;
		if (!Array.isArray(blocks) || !blocks.some((block) => block.type === "tool_use")) continue;
		return blocks.some(
			(block) => block.type === "tool_use" && block.name === "AskUserQuestion" && answered.has(block.id),
		);
	}
	return false;
}

/** Whether an assistant line calls a tool, so the parent is still mid-turn after it. */
function callsTool(line: SessionLine): boolean {
	const content = line.type === "assistant" ? line.message?.content : undefined;
	return Array.isArray(content) && content.some((block) => block.type === "tool_use");
}

/** The time of the parent's last record before `index`, when it last spoke or ran a tool. */
function lastParentRecordAt(lines: readonly SessionLine[], index: number): number {
	for (let previous = index - 1; previous >= 0; previous--) {
		const line = defined(lines[previous], "session line index is in range");
		const at = lineTimestamp(line);
		if ((line.type === "assistant" || line.type === "user") && at !== undefined) return Date.parse(at);
	}
	return Number.NEGATIVE_INFINITY;
}

/**
 * Upstream Normal folds background-task completions into the tool group beside
 * them ("Ran a command, finished a background command") rather than drawing a
 * user turn per `<task-notification>`; Verbose keeps the raw notification turns.
 */
function buildSessionListEntries(
	recordLines: SessionLine[],
	renderProps: LineRenderProps,
	verbose: boolean,
	held: HeldAssistantFooter | null,
	turnInProgress: boolean,
	archived: boolean,
): SessionListEntry[] {
	const waitingPrompts = recordLines.filter(
		(line): line is Extract<SessionLine, {type: "queued-prompt"}> => line.type === "queued-prompt",
	);
	const transcriptLines =
		waitingPrompts.length === 0 ? recordLines : recordLines.filter((line) => line.type !== "queued-prompt");
	const lines = verbose
		? transcriptLines
		: withLocalCommandProse(withQueuedPrompts(withNotificationsAtEnqueueTime(transcriptLines)));
	const lineAt = (index: number): SessionLine => defined(lines[index], "session line index is in range");
	const foldNotifications = !verbose;
	const noticeOf = (index: number): FoldedNotice | null => {
		if (!foldNotifications) return null;
		const line = lineAt(index);
		const notification = taskNotificationOf(line);
		if (notification !== null && agentCompletionOf(line) === null) {
			return {kind: "task", lineIndex: line.lineIndex, notification};
		}
		const message = foldablePeerMessage(lines, index, renderProps.subagentLookup);
		if (message !== null) return {kind: "peer", lineIndex: line.lineIndex, message, leads: true};
		return repromptsIntoTools(index) && line.type === "user"
			? {kind: "hook", lineIndex: line.lineIndex, line}
			: null;
	};
	/** Stop-hook feedback whose next shown line is a tool-only line, which upstream folds it into. */
	const repromptsIntoTools = (index: number): boolean => {
		const line = lineAt(index);
		if (line.type !== "user" || classifyUserContent(line) !== "stop-hook" || !renderProps.showTools) return false;
		for (let next = index + 1; next < lines.length; next++) {
			if (skipSet.has(next) || !isLineVisible(lineAt(next), renderProps, verbose)) continue;
			return isGroupableToolOnlyAssistantLine(lineAt(next), renderProps.toolResultMap);
		}
		return false;
	};
	const skipSet = buildSkipSet(lines);
	const hoistedCompletions = verbose ? new Map<number, never>() : hoistedAgentCompletions(lines);
	if (!verbose) {
		for (const index of settledCompletionIndices(lines)) skipSet.add(index);
		for (const index of localCommandIndices(lines)) skipSet.add(index);
		for (const {index} of hoistedCompletions.values()) skipSet.add(index);
	}
	const undeliveredRows = undeliveredTaskRows(
		lines,
		(index) => !skipSet.has(index) && isLineVisible(lineAt(index), renderProps, verbose),
	);
	for (const [index, line] of lines.entries()) {
		if (line.type === "queued-task-notification" && !undeliveredRows.has(index)) skipSet.add(index);
	}
	const compactionStatuses: ReadonlySet<number> = renderProps.showCompactSummaries
		? new Set()
		: new Set(compactBoundariesBySummary(lines).keys());
	const displaySpans = verbose
		? undefined
		: collectAssistantDisplaySpans(lines, renderProps, skipSet, compactionStatuses);
	const sameSpan = (first: SessionLine, next: SessionLine) =>
		verbose ||
		(getSourceSessionId(first, renderProps.sessionId) === getSourceSessionId(next, renderProps.sessionId) &&
			displaySpans?.get(first.lineIndex) === displaySpans?.get(next.lineIndex));
	// Focus temporarily pins the existing row boundary. Hover never enters this builder.
	const crossesHeldEntry = (start: number, next: number) =>
		held !== null &&
		((start < held.startRecordIndex && next >= held.startRecordIndex) ||
			(start <= held.endRecordIndex && next > held.endRecordIndex));
	const footerFor = (line: SessionLine) => {
		if (verbose) return undefined;
		const span = displaySpans?.get(line.lineIndex);
		// A turn still waiting on its question has no actions yet upstream.
		if (span === undefined || asksPendingQuestion(line, renderProps.toolResultMap)) return null;
		return <AssistantDisplaySpanFooter span={span} />;
	};
	const turnChangesByLine = collectTurnChanges(lines, renderProps.toolResultMap, {
		showTools: renderProps.showTools,
		showThinking: renderProps.showThinking,
		turnInProgress,
	});
	const undoAnchor = archived ? undefined : lastTurnChangesAnchor(lines, turnChangesByLine);
	const entries: PendingSessionListEntry[] = [];
	let prevVisibleType: string | null = null;
	let i = 0;

	const initIndices: number[] = [];
	while (i < lines.length) {
		const line = lineAt(i);
		if (skipSet.has(i) || !isLineVisible(line, renderProps, verbose)) {
			i++;
			continue;
		}
		if (!SESSION_INIT_LINE_TYPES.has(line.type)) break;
		initIndices.push(i);
		i++;
	}
	const [firstInitIndex] = initIndices;
	if (firstInitIndex !== undefined) {
		entries.push({
			key: "session-init",
			startRecordIndex: lineAt(firstInitIndex).lineIndex,
			isPrompt: false,
			kind: "marker",
			element: (
				<SessionInitEntry
					key="session-init"
					lines={lines}
					indices={initIndices}
					resumed={isResumedTranscript(lines, renderProps)}
					{...renderProps}
				/>
			),
		});
		prevVisibleType = "session-init";
	}

	/** Notifications waiting for the tool group that follows them. */
	let leadingNotices: FoldedNotice[] = [];
	/** The index of the first of `leadingNotices`. */
	let leadingNoticesIndex = 0;
	/** Whether `leadingNotices` sit before a standalone row, so the run they join starts after it. */
	let leadingNoticesDeferred = false;
	/**
	 * The latest tool run drawn and how many standalone rows followed it. Upstream moves a notice
	 * beside a standalone call into the latest default run at or before it, else the next one.
	 */
	let lastDefaultRun: {
		entryIndex: number;
		rebuild: (notices: readonly FoldedNotice[]) => PendingSessionListEntry;
		line: SessionLine;
		notices: readonly FoldedNotice[];
		standalonesAfter: number;
	} | null = null;
	/** The latest default run still reachable from a notice at `line`, past only standalone rows. */
	const reachableDefaultRun = (line: SessionLine) =>
		lastDefaultRun !== null &&
		entries.length === lastDefaultRun.entryIndex + 1 + lastDefaultRun.standalonesAfter &&
		sameSpan(lastDefaultRun.line, line) &&
		!crossesHeldEntry(lastDefaultRun.line.lineIndex, line.lineIndex)
			? lastDefaultRun
			: null;
	/** Whether the shown line after `index` past standalone rows opens a tool run in `line`'s span. */
	const nextDefaultRunAfterStandalone = (index: number, line: SessionLine): boolean => {
		let passedStandalone = false;
		for (let next = index; next < lines.length; next++) {
			const nextLine = lineAt(next);
			if (
				skipSet.has(next) ||
				!isLineVisible(nextLine, renderProps, verbose) ||
				isToolResultOnlyUserLine(nextLine)
			)
				continue;
			if (!sameSpan(line, nextLine) || crossesHeldEntry(line.lineIndex, nextLine.lineIndex)) return false;
			if (isStandaloneToolOnlyAssistantLine(nextLine, renderProps.toolResultMap)) {
				passedStandalone = true;
				continue;
			}
			return passedStandalone && isGroupableToolOnlyAssistantLine(nextLine, renderProps.toolResultMap);
		}
		return false;
	};
	const slowCommands = new SlowCommandAbsorber(renderProps.subagentLookup);
	const pushIdleRow = (commands: readonly SlowCommand[], startRecordIndex: number) => {
		if (commands.length === 0) return;
		prevVisibleType = "assistant";
		entries.push({
			key: `idle-commands-${startRecordIndex}`,
			startRecordIndex,
			isPrompt: false,
			kind: "assistant_tool",
			opensWithStatus: "marker",
			element: <IdleCommandsRow commands={commands} />,
		});
	};
	/** Draws the slow commands that finished while the parent idled before the turn line `index` opens. */
	const pushIdleCommands = (index: number) => {
		const line = lineAt(index);
		const at = lineTimestamp(line);
		if (verbose || !opensTurn(line) || at === undefined) return;
		pushIdleRow(slowCommands.take(lastParentRecordAt(lines, index), Date.parse(at)), line.lineIndex - 0.75);
	};

	while (i < lines.length) {
		const line = lineAt(i);

		// The answer to a question draws the slow commands that finished while the parent waited for it.
		const answeredAt = verbose || !answersQuestion(lines, i) ? undefined : lineTimestamp(line);
		if (answeredAt !== undefined) {
			pushIdleRow(slowCommands.take(lastParentRecordAt(lines, i), Date.parse(answeredAt)), line.lineIndex - 0.75);
		}

		if (skipSet.has(i) || !isLineVisible(line, renderProps, verbose)) {
			i++;
			continue;
		}

		const hoisted = hoistedCompletions.get(i);
		if (hoisted !== undefined) {
			const statusIndex = line.lineIndex - 0.5;
			entries.push({
				key: `started-${line.lineIndex}`,
				startRecordIndex: statusIndex,
				isPrompt: false,
				kind: "assistant_tool",
				assistantSpan: displaySpans?.get(line.lineIndex),
				replyHead: line,
				opensWithStatus: "marker",
				element: <AgentCompletionRow completion={hoisted.completion} footer={null} />,
			});
		}

		const notice = noticeOf(i);
		if (notice !== null) {
			const notices = [notice];
			let j = i + 1;
			while (j < lines.length) {
				if (crossesHeldEntry(line.lineIndex, lineAt(j).lineIndex)) break;
				if (skipSet.has(j) || !isLineVisible(lineAt(j), renderProps, verbose)) {
					j++;
					continue;
				}
				const next = noticeOf(j);
				if (next === null || !sameSpan(line, lineAt(j))) break;
				notices.push(next);
				j++;
			}
			const following = lines[j];
			const leadsRun =
				following !== undefined &&
				isGroupableToolOnlyAssistantLine(following, renderProps.toolResultMap) &&
				renderProps.showTools &&
				// Stop-hook feedback belongs to no assistant span; it leads whichever run it re-prompted.
				(notice.kind === "hook" || sameSpan(line, following)) &&
				!crossesHeldEntry(line.lineIndex, following.lineIndex);
			const besideStandalone =
				!leadsRun &&
				following !== undefined &&
				renderProps.showTools &&
				isStandaloneToolOnlyAssistantLine(following, renderProps.toolResultMap);
			const previousRun = besideStandalone ? reachableDefaultRun(line) : null;
			const deferred = besideStandalone && previousRun === null && nextDefaultRunAfterStandalone(j, line);
			// A task notification opening a run gathers the idle slow commands into it instead.
			if (!(leadsRun && notice.kind === "task")) pushIdleCommands(i);
			if (previousRun !== null) {
				previousRun.notices = [...previousRun.notices, ...notices];
				entries[previousRun.entryIndex] = previousRun.rebuild(previousRun.notices);
			} else if (leadsRun || deferred) {
				leadingNotices = notices;
				leadingNoticesIndex = i;
				leadingNoticesDeferred = deferred;
			} else {
				prevVisibleType = "assistant";
				entries.push({
					key: `notice-${line.lineIndex}`,
					startRecordIndex: line.lineIndex,
					isPrompt: false,
					kind: "assistant_tool",
					assistantSpan: displaySpans?.get(line.lineIndex),
					element: <BackgroundNoticeRows notices={notices} footer={footerFor(line)} />,
				});
			}
			i = j;
			continue;
		}

		pushIdleCommands(i);

		// Group consecutive tool-only assistant lines
		if (isGroupableToolOnlyAssistantLine(line, renderProps.toolResultMap) && renderProps.showTools) {
			const groupStart = i;
			const groupIndices: number[] = [i];
			const notices = leadingNotices;
			leadingNotices = [];
			const startRecordIndex = leadingNoticesDeferred
				? line.lineIndex
				: (notices[0]?.lineIndex ?? line.lineIndex);
			leadingNoticesDeferred = false;
			let j = i + 1;
			while (j < lines.length) {
				const nextLine = lineAt(j);
				if (skipSet.has(j) || !isLineVisible(nextLine, renderProps, verbose)) {
					j++;
					continue;
				}
				if (isToolResultOnlyUserLine(nextLine)) {
					j++;
					continue;
				}
				if (crossesHeldEntry(startRecordIndex, nextLine.lineIndex)) break;
				const next = noticeOf(j);
				if (next !== null) {
					if (next.kind === "hook" || !sameSpan(line, nextLine)) break;
					notices.push(next.kind === "peer" ? {...next, leads: false} : next);
					j++;
					continue;
				}
				if (
					isGroupableToolOnlyAssistantLine(nextLine, renderProps.toolResultMap) &&
					sameSpan(line, nextLine) &&
					!hoistedCompletions.has(j)
				) {
					groupIndices.push(j);
					j++;
				} else {
					break;
				}
			}

			if (!verbose) {
				const openerIndex = notices.length > 0 ? leadingNoticesIndex : groupStart;
				// A task notification opening the run gathers the slow commands since the last row before it.
				let since = Date.parse(lineTimestamp(lineAt(openerIndex)) ?? "");
				if (notices[0]?.kind === "task") {
					since = Number.NEGATIVE_INFINITY;
					for (let previous = openerIndex - 1; previous >= 0; previous--) {
						const at = lineTimestamp(lineAt(previous));
						if (
							skipSet.has(previous) ||
							!isLineVisible(lineAt(previous), renderProps, verbose) ||
							at === undefined
						)
							continue;
						since = Date.parse(at);
						break;
					}
				}
				notices.push(...slowCommands.absorbInto(lines.slice(groupStart, j), since));
			}

			prevVisibleType = "assistant";

			const buildRun = (runNotices: readonly FoldedNotice[]): PendingSessionListEntry => {
				if (groupIndices.length === 1 && runNotices.length === 0) {
					return {
						key: `line-${line.lineIndex}`,
						startRecordIndex: line.lineIndex,
						isPrompt: false,
						kind: "assistant_tool",
						assistantSpan: displaySpans?.get(line.lineIndex),
						replyHead: line,
						...(line.type === "assistant" &&
						!hasAttribution(line, verbose) &&
						toolSectionOpensWithStatus(backgroundToolNames([line], renderProps.toolResultMap), 0)
							? {opensWithStatus: "status"}
							: {}),
						element: (
							<LineEntry
								line={line}
								nextLine={lines[groupStart + 1]}
								turnChanges={turnChangesByLine.get(line.lineIndex)}
								undoable={line.lineIndex === undoAnchor}
								footer={footerFor(line)}
								{...renderProps}
							/>
						),
					};
				} else {
					const groupLines = groupIndices.map((index) => lineAt(index));
					const groupChanges = groupLines
						.map((groupLine) => turnChangesByLine.get(groupLine.lineIndex))
						.find((changes) => changes !== undefined);
					// GroupedToolCallEntry draws the lines sharing the first one's source session as its first batch.
					const firstBatchEnd = groupLines.findIndex(
						(groupLine) =>
							getSourceSessionId(groupLine, renderProps.sessionId) !==
							getSourceSessionId(line, renderProps.sessionId),
					);
					const firstBatch = firstBatchEnd === -1 ? groupLines : groupLines.slice(0, firstBatchEnd);
					return {
						key: `group-${line.lineIndex}`,
						startRecordIndex,
						isPrompt: false,
						kind: "assistant_tool",
						assistantSpan: displaySpans?.get(line.lineIndex),
						replyHead: line,
						...(toolSectionOpensWithStatus(
							backgroundToolNames(firstBatch, renderProps.toolResultMap),
							firstBatchEnd === -1 ? runNotices.length : 0,
						)
							? {opensWithStatus: "status"}
							: {}),
						element: (
							<GroupedToolCallEntry
								entries={groupLines}
								notices={runNotices}
								turnChanges={groupChanges}
								undoable={groupChanges !== undefined && groupChanges.anchorLineIndex === undoAnchor}
								footer={footerFor(line)}
								{...renderProps}
							/>
						),
					};
				}
			};
			lastDefaultRun = {entryIndex: entries.length, rebuild: buildRun, line, notices, standalonesAfter: 0};
			entries.push(buildRun(notices));
			i = j;
			continue;
		}

		const undelivered = undeliveredRows.get(i);
		if (undelivered !== undefined) {
			prevVisibleType = "assistant";
			entries.push({
				key: `line-${line.lineIndex}`,
				startRecordIndex: line.lineIndex,
				isPrompt: false,
				kind: "assistant_tool",
				assistantSpan: displaySpans?.get(line.lineIndex),
				opensWithStatus: "marker",
				element: (
					<TaskEventStatusRow
						label={undelivered.label}
						detail={undelivered.detail}
						footer={footerFor(line)}
					/>
				),
			});
			i++;
			continue;
		}

		const agentCompletion = verbose ? null : agentCompletionOf(line);
		if (agentCompletion !== null) {
			prevVisibleType = "assistant";
			entries.push({
				key: `line-${line.lineIndex}`,
				startRecordIndex: line.lineIndex,
				isPrompt: false,
				kind: "assistant_tool",
				assistantSpan: displaySpans?.get(line.lineIndex),
				opensWithStatus: "marker",
				element: <AgentCompletionRow completion={agentCompletion} footer={footerFor(line)} />,
			});
			i++;
			continue;
		}

		const stoppedAgent = verbose ? null : stoppedAgentNoticeOf(line);
		if (stoppedAgent !== null) {
			const statusIndex = stoppedStatusIndex(line);
			const span = displaySpans?.get(statusIndex);
			entries.push({
				key: `stopped-${line.lineIndex}`,
				startRecordIndex: statusIndex,
				isPrompt: false,
				kind: "assistant_tool",
				assistantSpan: span,
				opensWithStatus: "marker",
				element: (
					<TaskEventStatusRow
						label="Background task stopped"
						detail={stoppedAgent}
						footer={span === undefined ? null : <AssistantDisplaySpanFooter span={span} />}
					/>
				),
			});
		}

		const isBannerAfterBanner =
			BANNER_LINE_TYPES.has(line.type) && prevVisibleType !== null && BANNER_LINE_TYPES.has(prevVisibleType);

		prevVisibleType = line.type;

		const nextLine = lines[i + 1];
		const renderLine = (
			precedesReply: boolean,
			precedesStatus: OpeningStatus | null = null,
			precedesPrompt = false,
		) => (
			<LineEntry
				line={line}
				nextLine={nextLine}
				turnChanges={turnChangesByLine.get(line.lineIndex)}
				undoable={line.lineIndex === undoAnchor}
				footer={footerFor(line)}
				precedesReply={precedesReply}
				precedesStatus={precedesStatus}
				precedesPrompt={precedesPrompt}
				{...(isBannerAfterBanner ? {className: "mt-1"} : {})}
				{...renderProps}
			/>
		);
		entries.push({
			key: `line-${line.lineIndex}`,
			startRecordIndex: line.lineIndex,
			isPrompt: isPromptLine(line),
			kind: transcriptRowKind(line),
			assistantSpan: displaySpans?.get(line.lineIndex),
			...(line.type === "assistant" ? {replyHead: line} : {}),
			...(compactionStatuses.has(line.lineIndex) ? {opensWithStatus: "marker"} : {}),
			...(!verbose && isOrdinaryPromptLine(line, renderProps) ? {prompt: {line, render: renderLine}} : {}),
			...(!verbose && (isProseOnlyAssistantLine(line) || isHookSystemMessageLine(line))
				? {prose: {render: (precedesStatus: OpeningStatus) => renderLine(false, precedesStatus)}}
				: {}),
			element: renderLine(false),
		});
		if (lastDefaultRun !== null && isStandaloneToolOnlyAssistantLine(line, renderProps.toolResultMap))
			lastDefaultRun.standalonesAfter++;
		i++;
	}

	// Commands that finished since the parent ended its last turn, which it still idles in.
	const lastSpoken = lines.findLast((line) => line.type === "assistant" || line.type === "user");
	const lastSpokenAt = lastSpoken === undefined ? undefined : lineTimestamp(lastSpoken);
	if (!verbose && lastSpoken?.type === "assistant" && lastSpokenAt !== undefined && !callsTool(lastSpoken)) {
		pushIdleRow(slowCommands.take(Date.parse(lastSpokenAt), Number.POSITIVE_INFINITY), lastSpoken.lineIndex + 0.5);
	}

	// Prompts still waiting in the CLI's queue close the transcript, after every written record.
	const lastRecordIndex = lines.at(-1)?.lineIndex ?? 0;
	for (const [position, line] of waitingPrompts.entries()) {
		entries.push({
			key: queuedEntryId(line.lineIndex),
			startRecordIndex: lastRecordIndex + (position + 1) / (waitingPrompts.length + 1),
			isPrompt: false,
			kind: "human",
			element: (
				<QueuedWaitingTurn entryId={queuedEntryId(line.lineIndex)} text={line.content} head={position === 0} />
			),
		});
	}

	// Decided on the final rendered sequence, so the boundary never depends on which rows are mounted.
	const opensReply = (index: number): boolean => {
		const prompt = entries[index - 1]?.prompt;
		const replyHead = entries[index]?.replyHead;
		return (
			prompt !== undefined &&
			replyHead !== undefined &&
			getSourceSessionId(prompt.line, renderProps.sessionId) ===
				getSourceSessionId(replyHead, renderProps.sessionId)
		);
	};
	// Upstream leaves 12px between prose and a status in the same assistant span (16px above a plain
	// marker), never across a span, a question card or a tasks view.
	const precedesStatus = (index: number): OpeningStatus | null => {
		const span = entries[index]?.assistantSpan;
		const next = entries[index + 1];
		return span !== undefined && next?.assistantSpan?.key === span.key ? (next.opensWithStatus ?? null) : null;
	};
	const finalRecordIndex = lines.at(-1)?.lineIndex ?? 0;
	return entries.map(({replyHead: _replyHead, prompt, prose, opensWithStatus: _opensWithStatus, ...entry}, index) => {
		const followingStatus = prose === undefined ? null : precedesStatus(index);
		return {
			...entry,
			...(prompt !== undefined && opensReply(index + 1) ? {element: prompt.render(true)} : {}),
			...(prompt !== undefined && entries[index + 1]?.prompt !== undefined
				? {element: prompt.render(false, null, true)}
				: {}),
			...(prose !== undefined && followingStatus !== null ? {element: prose.render(followingStatus)} : {}),
			opensReply: opensReply(index),
			// A status row drawn between two records starts at a half index; it still spans itself.
			endRecordIndex: Math.max(
				entry.startRecordIndex,
				Math.ceil(entries[index + 1]?.startRecordIndex ?? finalRecordIndex + 1) - 1,
			),
		};
	});
}

function VirtualizedSessionEntries({
	entries,
	shouldScrollToEnd,
	measurementKey,
	measurementSource,
}: {
	entries: SessionListEntry[];
	shouldScrollToEnd: boolean;
	measurementKey: string;
	measurementSource: object | undefined;
}) {
	const geometryReady = useContext(SessionTileGeometryReadyContext);
	const managesTileGeometry = geometryReady !== undefined;
	const handoffAttempted = useRef(false);
	const pendingHandoff = useRef<Map<string, number> | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const scrollerRef = useRef<Element | null>(null);
	const expansionStore = useProvidedContext(ExpansionStoreContext, "ExpansionStoreContext");
	const [restoration] = useState(() => {
		const saved =
			measurementSource !== undefined && expansionStore.size === 0
				? readTranscriptMeasurements(measurementKey, measurementSource)
				: undefined;
		return {source: measurementSource, saved, heights: new Map<string, number>(saved?.heights)};
	});
	const measuredHeightsRef = useRef(restoration.heights);
	const reusableRef = useRef(true);
	const handoffCompatibleRef = useRef(true);
	const restoringRangeRef = useRef((restoration.saved?.range.startIndex ?? 0) > 0);
	const savedRangeRef = useRef(restoration.saved?.range);
	const measurementWidthRef = useRef(0);
	const readingAnchorRef = useRef<TranscriptReadingAnchor | undefined>(undefined);
	const handoffAnchorRef = useRef<TranscriptReadingAnchor | undefined>(undefined);
	const scrollAnchorRef = useRef<ScrollAnchor | null>(null);
	const prependAnchorRef = useRef<ScrollAnchor | null>(null);
	const discardedGeometryRef = useRef<Map<string, number> | null>(null);
	const rangeSyncInputsRef = useRef<{heights?: Map<string, number>; update?: () => void}>({});
	const pendingJumpRef = useRef<number | null>(null);
	const pendingFocusIndexRef = useRef<number | null>(null);
	const [measuredHeights, setMeasuredHeights] = useState(measuredHeightsRef.current);
	const [jumpVersion, setJumpVersion] = useState(0);
	const [range, setRange] = useState<VirtualRange>(() => {
		if (restoration.saved) return restoration.saved.range;
		if (typeof window === "undefined" || entries.length <= INITIAL_MOUNTED_TURN_COUNT) {
			return {startIndex: 0, endIndex: entries.length};
		}
		return shouldScrollToEnd
			? {
					startIndex: entries.length - INITIAL_MOUNTED_TURN_COUNT,
					endIndex: entries.length,
				}
			: {startIndex: 0, endIndex: INITIAL_MOUNTED_TURN_COUNT};
	});
	useLayoutEffect(() => {
		if (measurementSource !== restoration.source) {
			reusableRef.current = false;
			handoffCompatibleRef.current = false;
		}
	}, [measurementSource, restoration.source]);
	useLayoutEffect(() => {
		const list = listRef.current;
		const source = restoration.source;
		if (!list || source === undefined) return undefined;
		const hidden = list.closest("[hidden]") !== null;
		let width = hidden
			? (restoration.saved?.width ?? measurementWidthRef.current)
			: list.getBoundingClientRect().width;
		// A nested pane move renders this instance before the old instance's
		// cleanup retains its geometry. Claim that one same-commit handoff here.
		if (managesTileGeometry && !handoffAttempted.current && !restoration.saved && expansionStore.size === 0) {
			handoffAttempted.current = true;
			const handoff = takeTranscriptHandoff(measurementKey, source);
			const saved = handoff ?? readTranscriptMeasurements(measurementKey, source);
			if (saved && (handoff || hidden || saved.width === width)) {
				if (handoff && !hidden && saved.width !== width) {
					handoffAnchorRef.current = handoff.anchor;
				}
				if (hidden) width = saved.width;
				const heights = new Map(saved.heights);
				pendingHandoff.current = heights;
				measuredHeightsRef.current = heights;
				savedRangeRef.current = saved.range;
				restoringRangeRef.current = saved.range.startIndex > 0;
				setMeasuredHeights(heights);
				setRange(saved.range);
			}
		}
		// Rendering only reads/clones. A committed mount owns the retained generation.
		discardTranscriptMeasurements(measurementKey);
		measurementWidthRef.current = width;
		if (!hidden && restoration.saved && restoration.saved.width !== width) {
			restoringRangeRef.current = false;
			measuredHeightsRef.current = new Map();
			if (managesTileGeometry) pendingHandoff.current = measuredHeightsRef.current;
			discardedGeometryRef.current = measuredHeightsRef.current;
			setMeasuredHeights(measuredHeightsRef.current);
		}
		return () => {
			if (pendingHandoff.current) return;
			const savedRange = savedRangeRef.current;
			if (
				savedRange !== undefined &&
				managesTileGeometry &&
				handoffCompatibleRef.current &&
				expansionStore.size === 0 &&
				readingAnchorRef.current
			) {
				rememberTranscriptHandoff(measurementKey, {
					width: list.closest("[hidden]") ? measurementWidthRef.current : list.getBoundingClientRect().width,
					heights: new Map(measuredHeightsRef.current),
					range: savedRange,
					source,
					anchor: readingAnchorRef.current,
				});
			}
			if (
				savedRange === undefined ||
				!reusableRef.current ||
				expansionStore.size !== 0 ||
				(!list.closest("[hidden]") && list.getBoundingClientRect().width !== measurementWidthRef.current)
			) {
				discardTranscriptMeasurements(measurementKey);
				return;
			}
			rememberTranscriptMeasurements(
				measurementKey,
				{
					width: measurementWidthRef.current,
					heights: measuredHeightsRef.current,
					range: savedRange,
				},
				source,
			);
		};
	}, [measurementKey, restoration, expansionStore, managesTileGeometry]);

	useLayoutEffect(() => {
		if (!pendingHandoff.current || pendingHandoff.current === measuredHeights) savedRangeRef.current = range;
	}, [range, measuredHeights]);
	useLayoutEffect(() => {
		if (pendingHandoff.current && pendingHandoff.current !== measuredHeights) return;
		const list = listRef.current;
		if (handoffAnchorRef.current && pendingHandoff.current && list) {
			// Measure the bounded carried window at its new width before restoring its
			// record anchor. Later observer delivery must not compensate these rows twice.
			const heights = new Map(measuredHeightsRef.current);
			let changed = false;
			for (const row of list.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")) {
				const entry = entries[Number(row.dataset["transcriptEntryIndex"])];
				if (!entry) continue;
				const height = row.getBoundingClientRect().height;
				if (heights.get(entry.key) !== height) changed = true;
				heights.set(entry.key, height);
			}
			if (changed) {
				measuredHeightsRef.current = heights;
				pendingHandoff.current = heights;
				setMeasuredHeights(heights);
				return;
			}
		}
		pendingHandoff.current = null;
		if (listRef.current?.closest("[hidden]")) return;
		geometryReady?.();
	}, [geometryReady, measuredHeights, range, entries]);

	// An earlier page landing prepends rows, which moves every window index. Translate the window
	// to the same records in this render and re-read the reader's row from the painted DOM, so the
	// prepend commit mounts the rows the reader sees and holdScrollAnchor puts them back before paint.
	const committedEntriesRef = useRef(entries);
	const [rangeFirstKey, setRangeFirstKey] = useState(entries[0]?.key);
	if (rangeFirstKey !== entries[0]?.key) {
		setRangeFirstKey(entries[0]?.key);
		const committed = committedEntriesRef.current;
		const shift = prependedRowCount(committed, entries, range.startIndex);
		if (shift > 0) {
			setRange({
				startIndex: Math.min(entries.length, range.startIndex + shift),
				endIndex: Math.min(entries.length, range.endIndex + shift),
			});
		}
		const list = listRef.current;
		const scroller = scrollerRef.current;
		if (list && scroller) {
			const nextKeys = new Set(entries.map((entry) => entry.key));
			prependAnchorRef.current = firstPaintedRow(list, scroller, scrollerViewport(scroller), committed, (key) =>
				nextKeys.has(key),
			);
		}
	}
	useLayoutEffect(() => {
		committedEntriesRef.current = entries;
	}, [entries]);
	// A row placed by discarded geometry is no reader's place; the estimated window starts afresh.
	useLayoutEffect(() => {
		if (measuredHeights !== discardedGeometryRef.current) return;
		discardedGeometryRef.current = null;
		scrollAnchorRef.current = null;
	}, [measuredHeights]);

	const prefixHeights = useMemo(() => {
		let total = 0;
		const result = [total];
		for (const entry of entries) {
			total += measuredHeights.get(entry.key) ?? ESTIMATED_TURN_HEIGHT_PIXELS;
			result.push(total);
		}
		return result;
	}, [entries, measuredHeights]);

	/**
	 * Keep the first painted row where the reader saw it. Mounting a row whose real
	 * height differs from its estimate, or a mounted row resizing, moves everything
	 * after it; the transcript scroller opts out of native scroll anchoring, so put
	 * that row back before the browser paints the move. Returns false while a jump,
	 * focus move or geometry handoff owns the scroll position.
	 */
	const holdScrollAnchor = useCallback((): boolean => {
		const list = listRef.current;
		const scroller = scrollerRef.current;
		if (
			!list ||
			!scroller ||
			pendingJumpRef.current !== null ||
			pendingFocusIndexRef.current !== null ||
			pendingHandoff.current ||
			handoffAnchorRef.current ||
			list.closest("[hidden]")
		) {
			// The scroll subscription re-attaches the scroller later in the same commit (whenever the
			// measured heights change), and the reader's row waits for it like a landed page does.
			if (list && scroller) {
				scrollAnchorRef.current = null;
				prependAnchorRef.current = null;
			}
			return false;
		}
		const viewport = scrollerViewport(scroller);
		const anchor = prependAnchorRef.current ?? scrollAnchorRef.current;
		prependAnchorRef.current = null;
		const row = anchor ? mountedRowFor(list, entries, anchor.entryKey) : undefined;
		if (anchor && row) {
			const {scrollTop} = scrollMetrics(scroller);
			const shift = row.getBoundingClientRect().top - viewport.top + scrollTop - anchor.contentTop;
			if (Math.abs(shift) >= 0.5) scroller.scrollTop = scrollTop + shift;
			// Stay on the held row while it is painted. Re-anchoring onto a row that just mounted
			// above it would ride along when that row settles its own height (a prompt's clamp
			// lands a render after it mounts), throwing the reader back down the transcript.
			const rect = row.getBoundingClientRect();
			if (rect.bottom > viewport.top && rect.top < viewport.top + viewport.height) {
				scrollAnchorRef.current = {
					entryKey: anchor.entryKey,
					contentTop: rect.top - viewport.top + scrollMetrics(scroller).scrollTop,
				};
				return true;
			}
		}
		scrollAnchorRef.current = firstPaintedRow(list, scroller, viewport, entries);
		return true;
	}, [entries]);

	const updateVisibleRange = useCallback(() => {
		const list = listRef.current;
		const scroller = scrollerRef.current;
		if (!list || !scroller || entries.length === 0 || !holdScrollAnchor()) return;
		// The persistent main element is still at the departed page's zero offset
		// until router restoration runs. Keep the saved window through that interval.
		if (restoringRangeRef.current && scroller.scrollTop === 0) return;
		restoringRangeRef.current = false;
		const viewport = scrollerViewport(scroller);
		const listTop = list.getBoundingClientRect().top;
		const viewportStart = Math.max(0, viewport.top - listTop);
		const viewportEnd = Math.max(viewportStart, viewport.top + viewport.height - listTop);
		const anchorIndex = entryIndexAtOffset(prefixHeights, viewportStart);
		const row = list.querySelector<HTMLElement>(`[data-transcript-entry-index="${anchorIndex}"]`);
		const anchorEntry = entries[anchorIndex];
		if (row && anchorEntry !== undefined) {
			const {scrollTop, scrollHeight, clientHeight} = scrollMetrics(scroller);
			readingAnchorRef.current = {
				entryKey: anchorEntry.key,
				offset: row.getBoundingClientRect().top - viewport.top,
				atEnd: scrollHeight - scrollTop - clientHeight <= END_FOLLOW_THRESHOLD_PIXELS,
			};
		}
		const nextRange = rangeForViewport(prefixHeights, viewportStart, viewportEnd);
		setRange((current) =>
			current.startIndex === nextRange.startIndex && current.endIndex === nextRange.endIndex
				? current
				: nextRange,
		);
	}, [entries, prefixHeights, holdScrollAnchor]);

	useLayoutEffect(() => {
		// A committed window can mount rows whose estimates were wrong. Hold the reader's
		// row, then measure those rows now so the window grows to cover the viewport
		// before paint rather than a frame later through the resize observer.
		const list = listRef.current;
		if (!list || !holdScrollAnchor()) return;
		let changed = false;
		for (const row of list.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")) {
			const entry = entries[Number(row.dataset["transcriptEntryIndex"])];
			if (!entry) continue;
			const height = row.getBoundingClientRect().height;
			if (height === 0) continue;
			const previousHeight = measuredHeightsRef.current.get(entry.key) ?? ESTIMATED_TURN_HEIGHT_PIXELS;
			if (Math.abs(previousHeight - height) < 0.5) continue;
			measuredHeightsRef.current.set(entry.key, height);
			changed = true;
		}
		if (changed) setMeasuredHeights(new Map(measuredHeightsRef.current));
	}, [entries, range.startIndex, range.endIndex, measuredHeights, holdScrollAnchor]);

	useLayoutEffect(() => {
		const list = listRef.current;
		if (!list) return undefined;
		const scroller = findScrollContainer(list);
		scrollerRef.current = scroller;
		updateVisibleRange();
		const frame = restoringRangeRef.current ? requestAnimationFrame(updateVisibleRange) : undefined;
		// Commit the window inside the scroll event, ahead of this frame's paint. A
		// scheduled render lands a frame later, after the scrolled-to spacer paints blank.
		const onScroll = () => {
			flushSync(updateVisibleRange);
		};
		scroller.addEventListener("scroll", onScroll, {passive: true});
		window.addEventListener("resize", updateVisibleRange, {passive: true});
		return () => {
			if (frame !== undefined) cancelAnimationFrame(frame);
			scroller.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", updateVisibleRange);
			scrollerRef.current = null;
		};
	}, [updateVisibleRange]);

	useLayoutEffect(() => {
		const list = listRef.current;
		if (!list || typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver((observations) => {
			// Expanded panes hide chat with display:none; zero rectangles are not new row measurements.
			if (list.closest("[hidden]")) return;
			let changed = false;
			for (const observation of observations) {
				if (observation.target === list) {
					const width = list.getBoundingClientRect().width;
					if (width !== measurementWidthRef.current) {
						// Preserve the settled tile's rendered prefix, including offscreen estimates.
						if (managesTileGeometry) measurementWidthRef.current = width;
						else reusableRef.current = false;
					}
					continue;
				}
				const element = observation.target;
				if (!(element instanceof HTMLElement)) continue;
				const index = Number(element.dataset["transcriptEntryIndex"]);
				const entry = entries[index];
				if (!entry) continue;
				const height = observation.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height;
				const previousHeight = measuredHeightsRef.current.get(entry.key) ?? ESTIMATED_TURN_HEIGHT_PIXELS;
				if (Math.abs(previousHeight - height) < 0.5) continue;
				measuredHeightsRef.current.set(entry.key, height);
				changed = true;
			}
			if (!changed) return;
			holdScrollAnchor();
			setMeasuredHeights(new Map(measuredHeightsRef.current));
		});
		if (restoration.source !== undefined) observer.observe(list);
		for (const element of list.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")) {
			observer.observe(element);
		}
		return () => {
			observer.disconnect();
		};
	}, [entries, range.startIndex, range.endIndex, managesTileGeometry, holdScrollAnchor, restoration.source]);

	useLayoutEffect(() => {
		const scroller = scrollerRef.current;
		const anchor = handoffAnchorRef.current;
		const list = listRef.current;
		if (anchor && !pendingHandoff.current && scroller) {
			const index = entries.findIndex((entry) => entry.key === anchor.entryKey);
			const row = list?.querySelector<HTMLElement>(`[data-transcript-entry-index="${index}"]`);
			if (row && list) {
				scroller.scrollTop = anchor.atEnd
					? scroller.scrollHeight
					: scroller.scrollTop +
						row.getBoundingClientRect().top -
						scrollerViewport(scroller).top -
						anchor.offset;
				const viewport = scrollerViewport(scroller);
				const start = Math.max(0, viewport.top - list.getBoundingClientRect().top);
				const nextRange = rangeForViewport(prefixHeights, start, start + viewport.height);
				if (nextRange.startIndex !== range.startIndex || nextRange.endIndex !== range.endIndex) {
					pendingHandoff.current = measuredHeights;
					setRange(nextRange);
					return;
				}
			}
			handoffAnchorRef.current = undefined;
		} else if (
			rangeSyncInputsRef.current.heights === measuredHeights &&
			rangeSyncInputsRef.current.update === updateVisibleRange
		) {
			// A plain range commit must not re-derive the range in the same frame: on a cold
			// deep link each mounted tail row clamps the scroller, cascading window swaps
			// before paint that register as layout shift. Scroll events and measurements drive it.
			return;
		}
		rangeSyncInputsRef.current = {heights: measuredHeights, update: updateVisibleRange};
		updateVisibleRange();
	}, [measuredHeights, updateVisibleRange, entries, prefixHeights, range]);

	useEffect(() => {
		function requestJump(event: Event) {
			if (!(event instanceof CustomEvent) || typeof event.detail !== "number") return;
			const recordIndex = event.detail;
			const entryIndex = entries.findIndex(
				(entry) => entry.startRecordIndex <= recordIndex && entry.endRecordIndex >= recordIndex,
			);
			if (entryIndex < 0) return;
			pendingJumpRef.current = recordIndex;
			setRange({
				startIndex: Math.max(0, entryIndex - 1),
				endIndex: Math.min(entries.length, entryIndex + 2),
			});
			setJumpVersion((version) => version + 1);
		}
		window.addEventListener(TRANSCRIPT_JUMP_REQUEST_EVENT, requestJump);
		return () => {
			window.removeEventListener(TRANSCRIPT_JUMP_REQUEST_EVENT, requestJump);
		};
	}, [entries]);

	useLayoutEffect(() => {
		const recordIndex = pendingJumpRef.current;
		const list = listRef.current;
		const scroller = scrollerRef.current;
		if (recordIndex === null || !list || !scroller) return undefined;
		const entryIndex = entries.findIndex(
			(entry) => entry.startRecordIndex <= recordIndex && entry.endRecordIndex >= recordIndex,
		);
		if (entryIndex < range.startIndex || entryIndex >= range.endIndex) return undefined;
		const viewport = scrollerViewport(scroller);
		const listOffset = list.getBoundingClientRect().top - viewport.top + scroller.scrollTop;
		scroller.scrollTop = Math.max(0, listOffset + prefixHeightAt(prefixHeights, entryIndex) - viewport.height / 2);
		const frame = requestAnimationFrame(() => {
			pendingJumpRef.current = null;
			jumpToMessage(recordIndex);
			updateVisibleRange();
		});
		return () => {
			cancelAnimationFrame(frame);
		};
	}, [entries, jumpVersion, prefixHeights, range.endIndex, range.startIndex, updateVisibleRange]);

	const promptIndices = useMemo(() => entries.flatMap((entry, index) => (entry.isPrompt ? [index] : [])), [entries]);
	usePromptJump({
		promptIndices,
		entryOffset: (index) => prefixHeightAt(prefixHeights, index),
		viewportOffset: () => {
			const list = listRef.current;
			const scroller = scrollerRef.current;
			if (!list || !scroller) return 0;
			const viewport = scrollerViewport(scroller);
			return viewport.top + stickyHeaderInset(scroller) - list.getBoundingClientRect().top;
		},
		scrollToEntry: (index) => {
			const list = listRef.current;
			const scroller = scrollerRef.current;
			if (!list || !scroller) return;
			const viewport = scrollerViewport(scroller);
			const listOffset = list.getBoundingClientRect().top - viewport.top + scroller.scrollTop;
			scroller.scrollTop = Math.max(
				0,
				listOffset + prefixHeightAt(prefixHeights, index) - stickyHeaderInset(scroller),
			);
			updateVisibleRange();
		},
	});

	useLayoutEffect(() => {
		const index = pendingFocusIndexRef.current;
		if (index === null || index < range.startIndex || index >= range.endIndex) return;
		pendingFocusIndexRef.current = null;
		listRef.current?.querySelector<HTMLElement>(`[data-transcript-entry-index="${index}"]`)?.focus();
	}, [range.startIndex, range.endIndex]);

	/** Upstream's arrow-key turn navigation: ArrowUp/ArrowDown on a focused article move to its neighbour. */
	const focusNeighbour = (event: React.KeyboardEvent<HTMLDivElement>, index: number) => {
		if (event.target !== event.currentTarget) return;
		if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
			const trigger = event.currentTarget.querySelector<HTMLElement>("[data-transcript-message-menu]");
			if (trigger) {
				event.preventDefault();
				const rect = trigger.getBoundingClientRect();
				trigger.dispatchEvent(
					new MouseEvent("contextmenu", {
						bubbles: true,
						cancelable: true,
						clientX: rect.left,
						clientY: rect.top,
					}),
				);
			}
			return;
		}
		const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
		const target = index + step;
		if (step === 0 || target < 0 || target >= entries.length) return;
		event.preventDefault();
		const mounted = listRef.current?.querySelector<HTMLElement>(`[data-transcript-entry-index="${target}"]`);
		if (mounted) {
			mounted.focus();
			return;
		}
		pendingFocusIndexRef.current = target;
		setRange({startIndex: Math.max(0, target - 1), endIndex: Math.min(entries.length, target + 2)});
	};

	const startIndex = Math.min(range.startIndex, entries.length);
	const endIndex = Math.max(startIndex, Math.min(range.endIndex, entries.length));
	const totalHeight = prefixHeights.at(-1) ?? 0;

	return (
		<div
			ref={listRef}
			role="feed"
			aria-label="Chat messages"
			data-testid="virtualized-transcript"
			onClickCapture={(event) => {
				if (event.target instanceof Element && event.target.closest("[aria-expanded],summary")) {
					reusableRef.current = false;
					handoffCompatibleRef.current = false;
				}
			}}
		>
			<div className="sr-only">Use the up and down arrow keys to move between messages</div>
			<div aria-hidden="true" data-transcript-spacer="before" style={{height: prefixHeights[startIndex]}} />
			{entries.slice(startIndex, endIndex).map((entry, offset) => {
				const index = startIndex + offset;
				const isLast = index === entries.length - 1;
				return (
					// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- ARIA feed articles take focus and move it with the arrow keys
					<div
						key={entry.key}
						role="article"
						aria-label={`Message ${index + 1}`}
						aria-posinset={index + 1}
						aria-setsize={entries.length}
						// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- ARIA feed articles are focusable
						tabIndex={isLast ? 0 : -1}
						onKeyDown={(event) => {
							focusNeighbour(event, index);
						}}
						data-assistant-span={entry.assistantSpan?.key}
						data-reply-boundary={entry.opensReply ? "" : undefined}
						className={entry.opensReply ? "pt-p5" : undefined}
						data-transcript-entry-index={index}
						data-testid="transcript-row"
						data-perf-row={entry.kind}
						data-perf-line={entry.startRecordIndex}
						data-perf-last={isLast ? "" : undefined}
					>
						<AssistantSpanEntryContext.Provider value={entry}>
							{entry.element}
						</AssistantSpanEntryContext.Provider>
					</div>
				);
			})}
			<div
				aria-hidden="true"
				data-transcript-spacer="after"
				style={{height: totalHeight - prefixHeightAt(prefixHeights, endIndex)}}
			/>
		</div>
	);
}

function SessionLineList({
	lines,
	shouldScrollToEnd,
	measurementKey,
	measurementSource,
	turnInProgress,
	archived,
	...renderProps
}: LineRenderProps & {
	lines: SessionLine[];
	shouldScrollToEnd: boolean;
	measurementKey: string;
	measurementSource: object | undefined;
	turnInProgress: boolean;
	archived: boolean;
}) {
	const verbose = useContext(TranscriptModeContext) === "verbose";
	const [held, setHeld] = useState<HeldAssistantFooter | null>(null);
	const entries = buildSessionListEntries(
		lines,
		renderProps,
		verbose,
		verbose ? null : held,
		turnInProgress,
		archived,
	);
	const [expansionStore] = useState(() => new Map<string, ExpansionToggle>());
	return (
		<ExpansionStoreContext.Provider value={expansionStore}>
			<AssistantSpanInteractions held={held} setHeld={setHeld}>
				<VirtualizedSessionEntries
					key={measurementSource === undefined ? undefined : measurementKey}
					entries={entries}
					shouldScrollToEnd={shouldScrollToEnd}
					measurementKey={measurementKey}
					measurementSource={measurementSource}
				/>
			</AssistantSpanInteractions>
		</ExpansionStoreContext.Provider>
	);
}

const HOOK_WARNING_SUBTYPES = new Set(["hook_non_blocking_error"]);
const HOOK_ERROR_SUBTYPES = new Set(["hook_cancelled", "hook_blocking_error"]);
/**
 * Diagnostic rows upstream claude.ai/code never draws in Normal: the agent and
 * skill listings, batching reminders, queued commands, auto-mode markers and
 * hook-injected context. Verbose keeps them.
 */
const VERBOSE_ONLY_SUBTYPES = new Set([
	"agent_listing_delta",
	"skill_listing",
	"batching_reminder_sent",
	"total_tokens_reminder",
	"token_usage",
	"queued_command",
	"auto_mode",
	"auto_mode_exit",
	"hook_additional_context",
]);
const STOP_HOOK_EVENTS = new Set(["Stop", "SubagentStop"]);
const SYSTEM_BANNER_SUBTYPES = new Set([
	"command_permissions",
	"deferred_tools_delta",
	"mcp_instructions_delta",
	"date_change",
	"task_reminder",
	"companion_intro",
	"ultrathink_effort",
	"invoked_skills",
	"edited_text_file",
	"file",
	"directory",
	"compact_file_reference",
	"selected_lines_in_ide",
	"opened_file_in_ide",
	"bash_output_audience_note",
	"credential_org",
	"date",
	"deferred_tools_record",
	"environment",
	"fork_briefing",
	"hook_permission_decision",
	"instructions",
	"model",
	"output_style",
	"output_style_instructions",
	"prompt_snapshot",
	"remote_session_change",
	"session_context",
	"silent_turn_reminder",
	"thinking_drop",
	"thinking_stripped",
	"skill_mention",
	"inlined_image_paths",
	"session_cron_carry",
]);

interface AttachmentHead {
	type: string | null;
	hookEvent: string | null;
	prompt: string | null;
}

function getAttachmentHead(json: string): AttachmentHead {
	try {
		const parsed = asRecord(JSON.parse(json)) ?? {};
		const {type, hookEvent, prompt} = parsed;
		return {
			type: typeof type === "string" ? type : null,
			hookEvent: typeof hookEvent === "string" ? hookEvent : null,
			prompt: typeof prompt === "string" ? prompt : null,
		};
	} catch {
		return {type: null, hookEvent: null, prompt: null};
	}
}

/** A hook's message to the user, which upstream draws as assistant prose ("PreToolUse:Bash says: …"). */
function isHookSystemMessageLine(line: SessionLine): boolean {
	return line.type === "attachment" && getAttachmentHead(line.attachmentJson).type === "hook_system_message";
}

/**
 * Diagnostic attachments shown only in Verbose, as are subagent hand-backs the
 * turn absorbed, which upstream never receives; queued task notifications fold
 * into the tool group.
 */
function isVerboseOnlyAttachment({type, hookEvent, prompt}: AttachmentHead): boolean {
	if (type === "queued_command") return prompt === null || parseTaskNotification(prompt) === null;
	if (type === "hook_blocking_error") return hookEvent !== null && STOP_HOOK_EVENTS.has(hookEvent);
	return type !== null && VERBOSE_ONLY_SUBTYPES.has(type);
}

/**
 * Check whether an assistant line has content that will render.
 * Returns false when all content blocks are empty text, hidden thinking,
 * or tool_use blocks with showTools off -- avoiding blank rows.
 */
function hasAssistantVisibleContent(line: SessionLine, showThinking: boolean, showTools: boolean): boolean {
	if (line.type !== "assistant") return true;
	const content = line.message?.content;
	if (!Array.isArray(content) || content.length === 0) return false;

	const hasText = content.some(isAssistantProseBlock);
	const hasThinking =
		showThinking &&
		content.some((b) => b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim() !== "");
	const hasMedia = content.some((b) => b.type === "image" || b.type === "document");
	const hasToolUse = showTools && content.some((b) => b.type === "tool_use");

	return hasText || hasThinking || hasMedia || hasToolUse;
}

function isLineVisible(
	line: SessionLine,
	{
		showPassedHooks,
		showHookWarnings,
		showHookErrors,
		showSystemBanners,
		showTranscriptOnly,
		showThinking,
		showTools,
	}: Pick<
		LineRenderProps,
		| "showPassedHooks"
		| "showHookWarnings"
		| "showHookErrors"
		| "showSystemBanners"
		| "showTranscriptOnly"
		| "showThinking"
		| "showTools"
	>,
	verbose: boolean,
): boolean {
	if (line.type === "agent-name" || line.type === "agent-color" || line.type === "permission-mode")
		return showSystemBanners;
	if (line.type === "worktree") return showSystemBanners;
	if (line.type === "system") {
		if (line.subtype === "stop_hook_summary") return verbose;
		return showSystemBanners;
	}
	if (line.type === "attachment") {
		const head = getAttachmentHead(line.attachmentJson);
		if (isVerboseOnlyAttachment(head)) return verbose;
		const subtype = head.type;
		if (subtype === "hook_success") return showPassedHooks;
		if (subtype && HOOK_WARNING_SUBTYPES.has(subtype)) return showHookWarnings;
		if (subtype && HOOK_ERROR_SUBTYPES.has(subtype)) return showHookErrors;
		if (subtype && SYSTEM_BANNER_SUBTYPES.has(subtype)) return showSystemBanners;
	}
	if (
		line.type === "user" &&
		line.isVisibleInTranscriptOnly === true &&
		line.isCompactSummary !== true &&
		!showTranscriptOnly
	) {
		return false;
	}
	if (line.type === "user") {
		const kind = classifyUserContent(line);
		// Upstream draws nothing for an interruption, so outside Verbose it must not break a reply boundary either.
		if (kind === "request-interrupted") return verbose;
		// UserEntry draws nothing for these in any mode, so an entry would only defeat the reply boundary.
		if (kind === "tool-result-only" || kind === "slash-command-body") return false;
	}
	if (!hasAssistantVisibleContent(line, showThinking, showTools)) return false;
	return true;
}

/**
 * Top-level switching function: reads line.type and delegates to
 * per-type entry components. Returns null when there is nothing to render
 * (e.g. tool-only assistant turns with showTools off).
 * Not a React component — no hooks, so it is safe to call as a plain function
 * and inspect the return value before deciding whether to render the wrapper div.
 */
function renderSessionMessage({
	line,
	sessionId,
	toolResultMap,
	subagentLookup,
	isSubagentSession,
	showThinking,
	showTools,
	showCompactSummaries,
	allowedImageRoots,
	nextLine,
}: LineRenderProps & {
	line: SessionLine;
	nextLine?: SessionLine | undefined;
}) {
	const sourceSessionId = getSourceSessionId(line, sessionId);

	switch (line.type) {
		case "user":
			return (
				<UserEntry
					line={line}
					sessionId={sourceSessionId}
					nextLine={nextLine}
					isSubagentSession={isSubagentSession}
					showCompactSummaries={showCompactSummaries}
					allowedImageRoots={allowedImageRoots}
				/>
			);
		case "assistant":
			return (
				<AssistantEntry
					line={line}
					sessionId={sourceSessionId}
					toolResultMap={toolResultMap}
					subagentLookup={subagentLookup}
					showThinking={showThinking}
					showTools={showTools}
				/>
			);
		case "agent-name":
			return <Banner icon={<Bot className="h-3.5 w-3.5" />} label={line.agentName} />;
		case "agent-color":
			return <Banner icon={<Palette className="h-3.5 w-3.5" />} label={`Agent color: ${line.agentColor}`} />;
		case "permission-mode":
			return <Banner icon={<Lock className="h-3.5 w-3.5" />} label={`Permission mode: ${line.permissionMode}`} />;
		case "artifact-link":
			return <ArtifactLinkBanner line={line} />;
		case "artifact-watch":
			return <ArtifactWatchBanner line={line} />;
		case "queued-task-notification":
			// buildSessionListEntries draws the ones upstream shows as task-event rows.
			return null;
		case "queued-prompt":
			// buildSessionListEntries draws waiting rows at the transcript tail.
			return null;
		case "attachment":
			return (
				<AttachmentBanner
					attachmentJson={line.attachmentJson}
					sessionId={sourceSessionId}
					uuid={line.uuid}
					rendered={line.rendered}
					renderedInHumanTurn={line.renderedInHumanTurn}
					renderedRole={line.renderedRole}
					absorbedMidTurn={line.absorbedMidTurn}
					sameAsDescriptions={line.sameAsDescriptions}
				/>
			);
		case "system":
			return <SystemBanner line={line} sessionId={sourceSessionId} />;
		case "worktree":
			return (
				<Banner icon={<GitBranch className="h-3.5 w-3.5" />} label={`Worktree: ${line.worktreeName}`}>
					<span className="font-mono text-t6" title={`main repo: ${line.originalCwd}`}>
						{line.originalBranch !== undefined && line.originalBranch !== line.worktreeBranch
							? `${line.originalBranch} → ${line.worktreeBranch}`
							: line.worktreeBranch}
					</span>
					{line.originalHeadCommit !== undefined && (
						<span className="font-mono text-t6" title={line.originalHeadCommit}>
							{line.originalHeadCommit.slice(0, 7)}
						</span>
					)}
					{line.enteredExisting === true && <span className="text-t6">entered existing</span>}
				</Banner>
			);
		case "unparsed":
			return (
				<Banner
					icon={<FileWarning className="h-3.5 w-3.5" />}
					label={`Unreadable ${line.recordType ?? "record"}`}
				>
					<span className="font-mono text-t6" title={line.issues.join("\n")}>
						{line.issues[0] ?? "did not match the transcript schema"}
					</span>
				</Banner>
			);
		default:
			return assertNever(line);
	}
}

type UserContentKind =
	| "command"
	| "bash"
	| "text"
	| "tool-result-only"
	| "request-interrupted"
	| "compact-summary"
	| "stop-hook"
	| "slash-command-body"
	| "agent-message";

function getUserContentText(line: MessageSessionLine): string {
	const content = line.message?.content;
	if (!content) return "";
	if (typeof content === "string") return content;
	const parts: string[] = [];
	for (const block of content) {
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts.join("\n").trim();
}

function hasDocumentBlock(line: MessageSessionLine): boolean {
	const content = line.message?.content;
	if (!content || typeof content === "string") return false;
	return content.some((block) => block.type === "document");
}

/**
 * Classify a user line's content: is it a command, bash input/output, or regular text?
 */
function classifyUserContent(line: MessageSessionLine): UserContentKind {
	const content = line.message?.content;
	if (!content) return "text";

	const text = getUserContentText(line);

	// Compact-summary: explicit flags trump everything.
	if (line.isCompactSummary === true || line.isVisibleInTranscriptOnly === true) {
		return "compact-summary";
	}

	// Request-interrupted: detect by content text shape.
	if (text && isRequestInterrupted(text)) {
		return "request-interrupted";
	}

	// The CLI injects agent hand-backs as meta user lines, so a user quoting the envelope stays text.
	if (line.isMeta === true && parseAgentMessage(text) !== null) return "agent-message";

	// Document attachments are always user-initiated, even when isMeta is set —
	// otherwise an isMeta line is either stop-hook feedback or a slash-command body.
	if (line.isMeta === true && !hasDocumentBlock(line)) {
		if (text.startsWith("Stop hook feedback:")) return "stop-hook";
		return "slash-command-body";
	}

	if (typeof content === "string") {
		if (parseCommandBlock(content)) return "command";
		if (parseBashInput(content)) return "bash";
		if (parseBashOutput(content)) return "bash";
		return "text";
	}

	// Array content: check for command or bash blocks, or tool_result only
	let hasCommand = false;
	let hasBash = false;
	let hasText = false;
	let hasToolResult = false;
	for (const block of content) {
		if (block.type === "text" && typeof block.text === "string") {
			if (parseCommandBlock(block.text)) hasCommand = true;
			else if (parseBashInput(block.text)) hasBash = true;
			else if (parseBashOutput(block.text)) hasBash = true;
			else if (block.text.includes("<local-command-caveat>")) {
				// skip caveat blocks
			} else {
				const cleaned = stripCommandTags(block.text);
				if (cleaned) hasText = true;
			}
		} else if (block.type === "tool_result") {
			hasToolResult = true;
		} else if (block.type === "image" || block.type === "document") {
			hasText = true;
		}
	}

	if (hasCommand) return "command";
	if (hasBash) return "bash";
	if (hasText) return "text";
	if (hasToolResult) return "tool-result-only";
	return "text";
}

function UserEntry({
	line,
	sessionId,
	nextLine,
	isSubagentSession,
	showCompactSummaries,
	allowedImageRoots,
}: {
	line: MessageSessionLine;
	sessionId: string;
	nextLine?: SessionLine | undefined;
	isSubagentSession: boolean;
	showCompactSummaries: boolean;
	allowedImageRoots: readonly string[];
}) {
	const kind = classifyUserContent(line);

	if (line.isCompactSummary === true && !showCompactSummaries) {
		return <CompactSummaryStub line={line} sessionId={sessionId} allowedImageRoots={allowedImageRoots} />;
	}

	if (kind === "command") {
		return <CommandEntry line={line} sessionId={sessionId} />;
	}

	if (kind === "bash") {
		const coalesceNext = hasBashInput(line) && nextLine?.type === "user" && hasBashOutput(nextLine);
		return <BashEntry line={line} outputLine={coalesceNext ? nextLine : undefined} sessionId={sessionId} />;
	}

	// Upstream never shows the CLI-injected skill expansion or meta notes; the invoking prompt stands alone.
	if (kind === "tool-result-only" || kind === "slash-command-body") {
		return null;
	}

	if (kind === "agent-message") {
		const message = parseAgentMessage(getUserContentText(line));
		return message === null ? null : (
			<UserTurn text={message.body}>
				<AgentMessageRow message={message} />
			</UserTurn>
		);
	}

	if (isSubagentSession) {
		return <SubagentPromptEntry line={line} sessionId={sessionId} />;
	}

	if (kind === "stop-hook") return <StopHookMarker line={line} />;

	if (isKeyOf(LABEL_BY_KIND, kind)) {
		const label = LABEL_BY_KIND[kind];
		return (
			<LabeledAutomatedEntry
				line={line}
				sessionId={sessionId}
				label={label}
				allowedImageRoots={allowedImageRoots}
			/>
		);
	}

	const {textNodes, mediaNodes, images} = renderUserContentBlocks(line, sessionId, allowedImageRoots);

	return (
		<UserTurn text={messageText(line)}>
			<TranscriptMessageMenu
				speaker="user"
				sessionId={sessionId}
				uuid={line.uuid}
				markdown={messageText(line)}
				render={<div className="flex flex-col items-end gap-g5 max-w-[85%] min-w-0" />}
			>
				<UserAttachments images={images} />
				{textNodes.length > 0 && (
					<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-r7 bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body leading-[1.2857] select-text">
						{textNodes}
					</div>
				)}
				{mediaNodes}
				<UserTurnActions line={line} sessionId={sessionId} readByClaude />
			</TranscriptMessageMenu>
		</UserTurn>
	);
}

type LabeledKind = "request-interrupted" | "compact-summary";

const LABEL_BY_KIND: Record<LabeledKind, string> = {
	"request-interrupted": "Request interrupted",
	"compact-summary": "Compact summary",
};

const STOP_HOOK_PREFIX_RE = /^Stop hook feedback:\s*/;

/**
 * Upstream's "Hook re-prompted Claude" marker: a muted 24px disclosure in the
 * assistant column whose body is the hook's feedback without its prefix.
 */
function StopHookMarker({line}: {line: MessageSessionLine}) {
	const [expanded, setExpanded] = useState(false);
	const bodyId = useId();
	const feedback = getUserContentText(line).replace(STOP_HOOK_PREFIX_RE, "");

	return (
		<div data-stop-hook-marker="" className="flex flex-col w-full min-w-0 py-px">
			<button
				type="button"
				aria-expanded={expanded}
				aria-controls={bodyId}
				onClick={() => {
					setExpanded(!expanded);
				}}
				className="group/step flex self-stretch min-w-0 me-[52px] items-center gap-g2 px-1 py-0.5 text-left outline-none hide-focus-ring focus-visible:ring-focus rounded-r3"
			>
				<span className="text-body min-w-0 truncate text-ink-muted group-hover/step:text-secondary">
					Hook re-prompted Claude
				</span>
				<span className="shrink-0 text-secondary">
					<ChevronIcon expanded={expanded} size={12} />
				</span>
			</button>
			{expanded && (
				<div id={bodyId} className="break-words ps-1">
					<div className="pt-1">
						<div className="font-mono text-caption text-secondary whitespace-pre-wrap break-all select-text">
							{feedback}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

/** The compaction a compact summary continues from: its boundary's metadata, keyed by the summary's line. */
const CompactBoundaryContext = createContext<ReadonlyMap<number, {meta: CompactMetadata}>>(new Map());

/**
 * Pair each compact summary with the `compact_boundary` record written just
 * before it, looking back past other system and attachment records.
 */
function compactBoundariesBySummary(lines: readonly SessionLine[]): ReadonlyMap<number, {meta: CompactMetadata}> {
	const bySummary = new Map<number, {meta: CompactMetadata}>();
	let boundary: {meta: CompactMetadata} | null = null;
	for (const line of lines) {
		if (line.type === "system" && line.subtype === "compact_boundary") {
			boundary = {meta: line.compactMetadata};
		} else if (line.type === "user" && line.isCompactSummary === true) {
			if (boundary !== null) bySummary.set(line.lineIndex, boundary);
			boundary = null;
		} else if (line.type === "user" || line.type === "assistant") {
			boundary = null;
		}
	}
	return bySummary;
}

/**
 * Upstream's compaction status row, "Compacted session · saved 260.8k tokens",
 * a plain marker as upstream draws it; Verbose keeps the compact-summary text
 * behind it as the expandable body.
 */
function CompactedSessionStatus({
	label,
	line,
	sessionId,
	allowedImageRoots,
}: {
	label: string;
	line: MessageSessionLine;
	sessionId: string;
	allowedImageRoots: readonly string[];
}) {
	const [expanded, setExpanded] = useState(false);
	const bodyId = useId();
	const verbose = useContext(TranscriptModeContext) === "verbose";
	if (!verbose) {
		return (
			<TurnStatusFrame leading={false}>
				<div data-turn-status="" className={TURN_STATUS_CLASS}>
					<div data-turn-status-marker="" className="flex min-w-0 me-[52px] px-1 py-0.5">
						<span className="text-body min-w-0 truncate text-ink-muted">{label}</span>
					</div>
				</div>
			</TurnStatusFrame>
		);
	}
	return (
		<TurnStatusFrame leading={false}>
			<div data-turn-status="" className={TURN_STATUS_CLASS}>
				<button
					type="button"
					aria-expanded={expanded}
					aria-controls={bodyId}
					onClick={() => {
						setExpanded(!expanded);
					}}
					className="group/tool flex self-stretch min-w-0 me-[52px] items-center gap-g1 px-1 py-0.5 text-left outline-none hide-focus-ring focus-visible:ring-focus rounded-r3"
				>
					<span className="text-body min-w-0 truncate text-ink-muted group-hover/tool:text-secondary">
						{label}
					</span>
					<span className="shrink-0 text-ink-muted group-hover/tool:text-secondary">
						<ChevronIcon expanded={expanded} size={14} />
					</span>
				</button>
				{expanded && (
					<CompactSummaryBody
						id={bodyId}
						line={line}
						sessionId={sessionId}
						allowedImageRoots={allowedImageRoots}
					/>
				)}
			</div>
		</TurnStatusFrame>
	);
}

/**
 * Upstream's "Compacted conversation" marker row, keeping the local
 * compact-summary text behind it as the expandable body. A summary that follows
 * a compaction boundary reads as upstream's compaction status row instead.
 */
function CompactSummaryStub({
	line,
	sessionId,
	allowedImageRoots,
}: {
	line: MessageSessionLine;
	sessionId: string;
	allowedImageRoots: readonly string[];
}) {
	const [expanded, setExpanded] = useState(false);
	const bodyId = useId();
	const boundary = useContext(CompactBoundaryContext).get(line.lineIndex);

	if (boundary !== undefined) {
		return (
			<CompactedSessionStatus
				label={compactBoundaryLabel(boundary.meta)}
				line={line}
				sessionId={sessionId}
				allowedImageRoots={allowedImageRoots}
			/>
		);
	}

	return (
		<UserTurn text="Compacted conversation">
			<div className="flex flex-col w-full min-w-0">
				<MarkerDisclosureButton
					label="Compacted conversation"
					expanded={expanded}
					bodyId={bodyId}
					onToggle={() => {
						setExpanded(!expanded);
					}}
				/>
				{expanded && (
					<CompactSummaryBody
						id={bodyId}
						line={line}
						sessionId={sessionId}
						allowedImageRoots={allowedImageRoots}
					/>
				)}
			</div>
		</UserTurn>
	);
}

function CompactSummaryBody({
	id,
	line,
	sessionId,
	allowedImageRoots,
}: {
	id: string;
	line: MessageSessionLine;
	sessionId: string;
	allowedImageRoots: readonly string[];
}) {
	const {textNodes, mediaNodes, images} = renderUserContentBlocks(line, sessionId, allowedImageRoots);

	return (
		<div id={id} className="flex justify-end pt-p6">
			<div className="flex flex-col items-end gap-g6 max-w-[85%] min-w-0">
				<UserAttachments images={images} />
				{textNodes.length > 0 && (
					<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-r7 bg-auto-msg-bg text-auto-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body select-text">
						{textNodes}
					</div>
				)}
				{mediaNodes}
				<UserTurnActions line={line} sessionId={sessionId} contextText="Compacted conversation" />
			</div>
		</div>
	);
}

function LabeledAutomatedEntry({
	line,
	sessionId,
	label,
	allowedImageRoots,
}: {
	line: MessageSessionLine;
	sessionId: string;
	label: string;
	allowedImageRoots: readonly string[];
}) {
	const {textNodes, mediaNodes, images} = renderUserContentBlocks(line, sessionId, allowedImageRoots);

	if (textNodes.length === 0 && mediaNodes.length === 0 && images.length === 0) return null;

	return (
		<UserTurn text={messageText(line)}>
			<div className="flex flex-col items-end gap-g6 max-w-[85%] min-w-0">
				<div className="flex items-center gap-1.5 px-1">
					<span className="text-[10px] font-medium text-t6 bg-surface-0 rounded-full px-2 py-0.5">
						{label}
					</span>
				</div>
				<UserAttachments images={images} />
				{textNodes.length > 0 && (
					<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-r7 bg-auto-msg-bg text-auto-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body select-text">
						{textNodes}
					</div>
				)}
				{mediaNodes}
				<UserTurnActions line={line} sessionId={sessionId} />
			</div>
		</UserTurn>
	);
}

function SubagentPromptEntry({line, sessionId}: {line: MessageSessionLine; sessionId: string}) {
	const content = line.message?.content;
	if (!content) return null;

	const textBlocks: string[] = [];
	if (typeof content === "string") {
		const cleaned = stripCommandTags(content);
		if (cleaned) textBlocks.push(cleaned);
	} else if (Array.isArray(content)) {
		for (const block of content) {
			if (block.type === "text" && typeof block.text === "string") {
				if (block.text.includes("<local-command-caveat>")) continue;
				const cleaned = stripCommandTags(block.text);
				if (cleaned) textBlocks.push(cleaned);
			}
		}
	}

	if (textBlocks.length === 0) return null;

	return (
		<div className="flex flex-col gap-[var(--chat-item-gap)] min-w-0 select-text">
			<div className="relative border-l-2 border-accent-100 pl-3">
				<div className="flex items-center gap-1.5 mb-1">
					<span className="text-[11px] font-medium text-accent-100 bg-accent-000/10 rounded-full px-2 py-0.5">
						&#x2191; Parent Agent
					</span>
				</div>
				<div className="text-body text-primary">
					<TruncatedContent>
						<MarkdownArticle markdown={textBlocks.join("\n\n")} />
					</TruncatedContent>
				</div>
				<DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-0 right-0" />
			</div>
		</div>
	);
}

function lineMatchesBash(line: MessageSessionLine, parser: (text: string) => unknown): boolean {
	const content = line.message?.content;
	if (typeof content === "string") return parser(content) !== null;
	if (Array.isArray(content)) {
		return content.some((b) => b.type === "text" && typeof b.text === "string" && parser(b.text) !== null);
	}
	return false;
}

function hasBashInput(line: MessageSessionLine): boolean {
	return lineMatchesBash(line, parseBashInput);
}

function hasBashOutput(line: MessageSessionLine): boolean {
	return lineMatchesBash(line, parseBashOutput);
}

interface UserContentBlocks {
	textNodes: React.ReactNode[];
	mediaNodes: React.ReactNode[];
	/** Pasted and path-referenced images, for the attachments strip above the bubble. */
	images: AttachedImage[];
}

/** A prompt's text; the first block of a prompt opens with a slash-command chip when it starts with `/name`. */
function UserPromptText({text, leading}: {text: string; leading: boolean}) {
	const command = leading ? splitLeadingSlashCommand(text) : null;
	if (command === null) return <UserPlainText text={text} />;
	return <SlashCommandText name={command.name} rest={command.rest} />;
}

/** A prompt's bubble text, without command tags or the harness tags upstream hides. */
function cleanPromptText(text: string): string {
	return stripHarnessTags(stripCommandTags(text)).trim();
}

function renderUserContentBlocks(
	line: MessageSessionLine,
	sessionId: string,
	allowedImageRoots: readonly string[],
): UserContentBlocks {
	const content = line.message?.content;
	if (!content) return {textNodes: [], mediaNodes: [], images: []};

	if (typeof content === "string") {
		const cleaned = cleanPromptText(content);
		if (!cleaned) return {textNodes: [], mediaNodes: [], images: []};
		return {
			textNodes: [
				<React.Fragment key={0}>
					<TruncatedContent>
						<UserPromptText text={cleaned} leading={true} />
					</TruncatedContent>
					<DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
				</React.Fragment>,
			],
			mediaNodes: [],
			images: inlinePathImages(cleaned, allowedImageRoots),
		};
	}

	const textNodes: React.ReactNode[] = [];
	const mediaNodes: React.ReactNode[] = [];
	const images: AttachedImage[] = [];
	const inlineImageText: string[] = [];
	for (const [i, block] of content.entries()) {
		if (block.type === "text" && typeof block.text === "string") {
			if (block.text.includes("<local-command-caveat>")) continue;
			const cleaned = cleanPromptText(block.text);
			if (!cleaned) continue;
			inlineImageText.push(cleaned);
			textNodes.push(
				<React.Fragment key={`text-${i}`}>
					<TruncatedContent>
						<UserPromptText text={cleaned} leading={textNodes.length === 0} />
					</TruncatedContent>
					<DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
				</React.Fragment>,
			);
		} else if (block.type === "image") {
			images.push({
				key: `img-${i}`,
				src: `data:${block.source.media_type};base64,${block.source.data}`,
				label: "Attached image",
			});
		} else if (block.type === "document") {
			mediaNodes.push(
				<div
					key={`doc-${i}`}
					className="relative rounded-lg px-3 py-2 bg-surface-1 text-primary flex items-center gap-1.5"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						className="shrink-0"
					>
						<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
						<polyline points="13 2 13 9 20 9" />
					</svg>
					<span className="text-sm">PDF attached</span>
					<DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
				</div>,
			);
		}
		// tool_result blocks are intentionally skipped in user rendering
	}
	if (inlineImageText.length > 0) images.push(...inlinePathImages(inlineImageText.join("\n"), allowedImageRoots));
	return {textNodes, mediaNodes, images};
}

function CommandEntry({line, sessionId}: {line: MessageSessionLine; sessionId: string}) {
	const content = line.message?.content;
	let cmdName = "";
	let cmdArgs: string | undefined;

	if (typeof content === "string") {
		const cmd = parseCommandBlock(content);
		if (cmd) {
			cmdName = cmd.name;
			cmdArgs = cmd.args;
		}
	} else if (Array.isArray(content)) {
		for (const block of content) {
			if (block.type === "text" && typeof block.text === "string") {
				const cmd = parseCommandBlock(block.text);
				if (cmd) {
					cmdName = cmd.name;
					cmdArgs = cmd.args;
					break;
				}
			}
		}
	}

	const name = cmdName.replace(/^\//, "");

	return (
		<UserTurn text={cmdArgs ? `/${name} ${cmdArgs}` : `/${name}`}>
			<div className="flex flex-col items-end gap-g5 max-w-[85%] min-w-0">
				<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-r7 bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body leading-[1.2857] select-text">
					<TruncatedContent>
						<SlashCommandText name={name} rest={cmdArgs ?? ""} />
					</TruncatedContent>
					<DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
				</div>
				<UserTurnActions
					line={line}
					sessionId={sessionId}
					contextText={cmdArgs ? `/${name} ${cmdArgs}` : `/${name}`}
					readByClaude
				/>
			</div>
		</UserTurn>
	);
}

function BashEntry({
	line,
	outputLine,
	sessionId,
}: {
	line: MessageSessionLine;
	outputLine?: MessageSessionLine | undefined;
	sessionId: string;
}) {
	let command = "";
	let stdout: string | undefined;
	let stderr: string | undefined;
	const outputUuid = outputLine?.uuid;

	function extractBash(content: string | SessionContentBlock[] | undefined) {
		if (!content) return;
		if (typeof content === "string") {
			const bashIn = parseBashInput(content);
			if (bashIn) command = bashIn.command;
			const bashOut = parseBashOutput(content);
			if (bashOut) {
				stdout = bashOut.stdout;
				stderr = bashOut.stderr;
			}
		} else if (Array.isArray(content)) {
			for (const block of content) {
				if (block.type !== "text" || typeof block.text !== "string") continue;
				const bashIn = parseBashInput(block.text);
				if (bashIn) command = bashIn.command;
				const bashOut = parseBashOutput(block.text);
				if (bashOut) {
					stdout = bashOut.stdout;
					stderr = bashOut.stderr;
				}
			}
		}
	}

	extractBash(line.message?.content);
	if (outputLine) extractBash(outputLine.message?.content);

	if (!command && !stdout && !stderr) return null;

	return (
		<div className="flex flex-col items-end gap-1">
			<div className="relative rounded-lg p-2 bg-surface-1 text-primary max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] min-w-0">
				{command && (
					<div className="bg-surface-0 rounded px-2 py-1.5 font-mono text-xs flex items-start gap-2">
						<span className="text-t6">! </span>
						<span className="text-success-000 break-all flex-1">{command}</span>
						<DebugLink sessionId={sessionId} uuid={line.uuid} />
					</div>
				)}
				{stdout && (
					<div className="mt-1 relative">
						<TerminalOutput content={stdout} />
						<DebugLink
							sessionId={sessionId}
							uuid={outputUuid ?? line.uuid}
							className="absolute top-1 right-1"
						/>
					</div>
				)}
				{stderr && (
					<div className="mt-1 border-l-2 border-danger-000 bg-danger-000/10 rounded-r relative">
						<TerminalOutput content={stderr} />
						{!stdout && (
							<DebugLink
								sessionId={sessionId}
								uuid={outputUuid ?? line.uuid}
								className="absolute top-1 right-1"
							/>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * Thinking text, rendered the way upstream claude.ai/code does: always visible,
 * inline italic body type in the 50%-ink layer behind a left rail. The right
 * padding reserves the gutter the hover-revealed controls sit in.
 *
 * The group is named `body` rather than upstream's `thinking` so the shared
 * `CopyButton` hover reveal applies unchanged.
 */
function ThinkingBlock({
	thinking,
	sessionId,
	sourceUuid,
	durationMs,
}: {
	thinking: string;
	sessionId: string;
	sourceUuid: string | undefined;
	durationMs: number | undefined;
}) {
	const {settings} = useSettings();
	// Upstream's pr-6 fits the copy button alone. When DebugLink renders it
	// shares the overlay, so the gutter has to grow or long lines run under it.
	const gutterClass = settings.showDebug && sourceUuid ? "pr-10" : "pr-6";
	return (
		<div className="border-l-2 border-t2 pl-3">
			{durationMs !== undefined && (
				<div className="text-xs text-t6 mb-1">Thought for {formatThinkingDuration(durationMs)}</div>
			)}
			<div className="group/body relative">
				<div className={`text-body text-t6 italic whitespace-pre-wrap break-words ${gutterClass}`}>
					{thinking}
				</div>
				<div className="absolute right-0 top-0 flex items-center gap-g3">
					<DebugLink sessionId={sessionId} uuid={sourceUuid} />
					<CopyButton text={toMarkdownQuote(thinking)} label="Copy as quote" />
				</div>
			</div>
		</div>
	);
}

function formatThinkingDuration(ms: number): string {
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = Math.round((ms % 60_000) / 1000);
	return `${mins}m ${secs}s`;
}

function toMarkdownQuote(text: string): string {
	return text
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}

/**
 * Renders an assistant JSONL line by iterating content blocks in original order.
 */
function AssistantEntry({
	line,
	sessionId,
	toolResultMap,
	subagentLookup,
	showThinking,
	showTools,
}: {
	line: MessageSessionLine;
	sessionId: string;
	toolResultMap: Map<string, ToolResultInfo>;
	subagentLookup: SubagentLookup;
	showThinking: boolean;
	showTools: boolean;
}) {
	const liveFailures = useLiveToolFailures(sessionId);
	const verbose = useContext(TranscriptModeContext) === "verbose";
	const opensReply = useContext(AssistantSpanEntryContext)?.opensReply === true;
	const toolCalls = useMemo(
		() => buildLineToolCalls(line, toolResultMap, liveFailures, subagentLookup),
		[line, toolResultMap, liveFailures, subagentLookup],
	);

	const content = line.message?.content;
	if (!Array.isArray(content) || content.length === 0) {
		return null;
	}

	const hasVisibleNonToolContent = content.some(
		(b) =>
			isAssistantProseBlock(b) ||
			(b.type === "thinking" && showThinking && typeof b.thinking === "string" && b.thinking.trim() !== "") ||
			b.type === "image" ||
			b.type === "document",
	);
	const hasToolUse = toolCalls.length > 0;

	// No visible content at all -- hide the entry entirely
	if (!hasVisibleNonToolContent && !hasToolUse) {
		return null;
	}

	const attributionRow = <AttributionRow line={line} verbose={verbose} />;
	const requestDisclosure = verbose && line.requestRef !== undefined && (
		<ApiRequestDisclosure sessionId={sessionId} requestRef={line.requestRef} />
	);

	// Only tool_use blocks -- render as a tool call section
	if (!hasVisibleNonToolContent && hasToolUse) {
		if (!showTools) return null;
		return (
			<>
				{attributionRow}
				<ToolCallSection
					calls={toolCalls}
					sessionId={sessionId}
					leading={opensReply && !hasAttribution(line, verbose)}
				/>
				{requestDisclosure}
			</>
		);
	}

	// Upstream draws a usage-limit error as its card alone; the raw limit text is not shown.
	const limitCard =
		line.isApiErrorMessage === true
			? usageLimitCard(
					line.usageLimit,
					content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
					Date.now(),
				)
			: null;

	// Mixed content: render each block in original order
	return (
		<div className="flex flex-col gap-[var(--chat-item-gap)] min-w-0 select-text">
			{attributionRow}
			{limitCard === null ? (
				line.isApiErrorMessage === true && <ApiErrorCallout line={line} />
			) : (
				<UsageLimitCardView card={limitCard} />
			)}
			{(limitCard === null ? content : content.filter((block) => block.type !== "text")).map((block, i) => (
				<ContentBlock
					key={i}
					block={block}
					blockIndex={i}
					line={line}
					sessionId={sessionId}
					showThinking={showThinking}
					showTools={showTools}
					toolCalls={toolCalls}
				/>
			))}
			{requestDisclosure}
		</div>
	);
}

/** Upstream draws no skill or MCP attribution, so only Verbose shows it. */
function hasAttribution(line: MessageSessionLine, verbose: boolean): boolean {
	return verbose && (line.attributionSkill ?? line.attributionPlugin ?? line.attributionMcpServer) !== undefined;
}

/**
 * Pills attributing an assistant turn to the skill or MCP server that drove
 * it. The transcript layer dedupes consecutive identical attribution, so this
 * renders once per skill/MCP block.
 */
function AttributionRow({line, verbose}: {line: MessageSessionLine; verbose: boolean}) {
	if (!hasAttribution(line, verbose)) return null;
	const skillLabel = line.attributionSkill ?? line.attributionPlugin;
	const mcpLabel = line.attributionMcpServer
		? `${line.attributionMcpServer}${line.attributionMcpTool ? ` · ${line.attributionMcpTool}` : ""}`
		: undefined;
	return (
		<div className="flex flex-wrap gap-1.5">
			{skillLabel && (
				<span className="inline-flex items-center gap-1 text-[11px] text-t6 bg-surface-1 rounded-full px-2 py-0.5">
					<Zap className="h-3 w-3" />
					{skillLabel}
				</span>
			)}
			{mcpLabel && (
				<span className="inline-flex items-center gap-1 text-[11px] text-t6 bg-surface-1 rounded-full px-2 py-0.5">
					<Plug className="h-3 w-3" />
					{mcpLabel}
				</span>
			)}
		</div>
	);
}

/**
 * Upstream's usage-limit error card: the shared error card shell with a danger
 * gauge, the limit's headline and its hint. Upstream's Try
 * again and Open usage settings are left out: a resend is not safe from here
 * and the settings fix is billing.
 */
function UsageLimitCardView({card}: {card: UsageLimitCard}) {
	return (
		<ErrorCardShell data={{"data-usage-limit-card": ""}} headline={card.headline} hint={card.hint} icon="gauge" />
	);
}

/** Error callout for assistant turns flagged as API error messages. */
function ApiErrorCallout({line}: {line: MessageSessionLine}) {
	const details = line.errorDetails;
	const detailsText =
		details === undefined ? undefined : typeof details === "string" ? details : JSON.stringify(details, null, 2);
	return (
		<div className="border-l-2 border-danger-000 bg-danger-000/10 rounded-r px-3 py-2">
			<div className="flex items-center gap-1.5 text-xs text-danger-000">
				<AlertTriangle className="h-3.5 w-3.5" />
				API Error{line.apiErrorStatus === undefined ? "" : ` ${line.apiErrorStatus}`}
			</div>
			{detailsText !== undefined && (
				<div className="mt-1">
					<CollapsibleSection label="Details">
						<Pre>{detailsText}</Pre>
					</CollapsibleSection>
				</div>
			)}
		</div>
	);
}

/**
 * Switching component for individual content blocks within an assistant message.
 */
function ContentBlock({
	block,
	blockIndex,
	line,
	sessionId,
	showThinking,
	showTools,
	toolCalls,
}: {
	block: SessionContentBlock;
	blockIndex: number;
	line: MessageSessionLine;
	sessionId: string;
	showThinking: boolean;
	showTools: boolean;
	toolCalls: ClientToolCall[];
}) {
	const prose = block.type === "text" ? block.text : narrationProse(block);
	if (typeof prose === "string") {
		if (!prose.trim()) return null;
		return (
			<div className="relative min-w-0 text-body text-primary" data-transcript-prose>
				<ProseMarkdown markdown={prose} smartQuotes />
				<DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-0 right-0" />
			</div>
		);
	}

	if (block.type === "thinking" && typeof block.thinking === "string") {
		if (!showThinking || !block.thinking.trim()) return null;
		return (
			<ThinkingBlock
				thinking={block.thinking}
				sessionId={sessionId}
				sourceUuid={line.uuid}
				durationMs={line.thinkingDurationMs}
			/>
		);
	}

	if (block.type === "tool_use") {
		if (!showTools) return null;
		// Render the full tool call section when we hit the first tool_use block
		// (subsequent tool_use blocks in the same line are rendered as part of this section)
		const content = line.message?.content;
		const firstToolUseIndex = Array.isArray(content) ? content.findIndex((b) => b.type === "tool_use") : -1;
		if (blockIndex !== firstToolUseIndex) return null;
		return <ToolCallSection calls={toolCalls} sessionId={sessionId} />;
	}

	if (block.type === "image") {
		return (
			<div className="relative inline-block">
				<img
					src={`data:${block.source.media_type};base64,${block.source.data}`}
					alt="Attachment"
					className="max-w-full max-h-96 rounded-lg border border-border shadow-sm"
				/>
				<DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
			</div>
		);
	}

	if (block.type === "document") {
		return (
			<div className="relative rounded-lg px-3 py-2 bg-surface-1 text-primary flex items-center gap-1.5">
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					className="shrink-0"
				>
					<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
					<polyline points="13 2 13 9 20 9" />
				</svg>
				<span className="text-sm">PDF attached</span>
				<DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
			</div>
		);
	}

	return null;
}

/**
 * A Read bound (`offset`/`limit`) as a positive integer. Claude Code has
 * written these as strings on disk (`"offset": "55, "`), so parse rather than
 * cast, and treat anything non-positive as absent.
 */
function readBound(value: unknown): number | null {
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
	if (!Number.isFinite(parsed) || parsed < 1) return null;
	return Math.trunc(parsed);
}

/**
 * The line range of a partial Read, as upstream appends it to the row
 * ("Read archive-completed.ts (220-239)"), so a slice is distinguishable from
 * a whole-file read. Null when the call read the whole file.
 *
 * Upstream also merges the ranges of repeated reads of one file into a single
 * row ("(220-239, 465-47...)"); we keep every call on its own row instead, so
 * that no per-call duration, result, or debug link is lost.
 */
function readRangeLabel(call: ClientToolCall): string | null {
	if (call.name !== "Read") return null;
	const offset = readBound(call.input["offset"]);
	const limit = readBound(call.input["limit"]);
	if (offset === null && limit === null) return null;
	const start = offset ?? 1;
	if (limit === null) return `(${start}–)`;
	const end = start + limit - 1;
	return end === start ? `(${start})` : `(${start}–${end})`;
}

/**
 * Tools drawn in full rather than collapsed into a summary row; `toolBucket` owns run
 * splitting, this set only picks the renderer. Their renderer owns the card shell -- upstream draws a card once per body, so the wrapper
 * here stays a bare positioning context for the DebugLink.
 */
const PROMINENT_TOOLS = new Set(["AskUserQuestion"]);

/** A prominent tool's call, unless the user withdrew the question, which upstream draws as a row. */
function isProminentCall(call: AskedCall & {name: string}): boolean {
	return PROMINENT_TOOLS.has(call.name) && !isWithdrawnQuestion(call);
}

function ToolCallSection({
	calls,
	sessionId,
	notices = NO_NOTICES,
	leading = false,
}: {
	calls: ClientToolCall[];
	sessionId: string;
	notices?: readonly FoldedNotice[];
	/** The section is the first thing drawn in the row that opens a reply. */
	leading?: boolean;
}) {
	const prominentCalls = calls.filter(isProminentCall);
	const backgroundCalls = calls.filter((c) => !isProminentCall(c));
	const [loneBackgroundCall] = backgroundCalls;

	return (
		<>
			{backgroundCalls.length === 1 && notices.length === 0 && loneBackgroundCall !== undefined && (
				<ToolCallRow call={loneBackgroundCall} sessionId={sessionId} leading={leading} />
			)}
			{(backgroundCalls.length > 1 || notices.length > 0) && (
				<ToolCallSummary calls={backgroundCalls} sessionId={sessionId} notices={notices} leading={leading} />
			)}
			{prominentCalls.map((call, i) => {
				const Renderer = getCallRenderer(call);
				return (
					<div key={`prominent-${i}`} className="relative">
						<Suspense fallback={null}>
							<Renderer toolCall={call} />
						</Suspense>
						<DebugLink sessionId={sessionId} uuid={call.sourceUuid} className="absolute top-1 right-1" />
					</div>
				);
			})}
		</>
	);
}

/**
 * Tools whose param is a file path -- shown as filename-only, in the row's own
 * sans body face but primary rather than secondary, as upstream draws it.
 */
const FILE_PARAM_TOOLS = new Set(["Read", "Edit", "MultiEdit", "Write"]);

/**
 * Tools whose renderer body already displays the param (e.g. URL),
 * so we suppress it from the ToolCallRow header to avoid duplication.
 */
const RENDERER_HANDLES_PARAM = new Set([
	"mcp__claude-in-chrome__navigate",
	"mcp__chrome-devtools__navigate_page",
	"mcp__plugin_playwright_playwright__browser_navigate",
]);

/** Tools upstream labels with a bare phrase, drawing no parameter beside it. */
const PARAMLESS_TOOLS = new Set(["ToolSearch"]);

/**
 * Tools whose renderer provides its own card shell (header + body).
 * These get a `group/body py-p6` wrapper with a `card-outline rounded-r6` inner
 * div -- a transparent panel drawn with a hairline ring, matching upstream's
 * `epitaxy-card-outline`.
 *
 * All other tools (KeyValueCard-style) get `group/body relative flex w-full flex-col pt-p3`
 * with no inner wrapper, matching upstream claude.ai/code.
 *
 * A row nested inside a grouped tool card never gets a card either: upstream
 * draws the card once, around the group.
 */
const CARD_STYLE_TOOLS = new Set(["Bash", "Read", "Edit", "MultiEdit", "Write"]);

/**
 * Nested bodies whose renderer emits its copy button as a row sibling of the
 * content, so the body wrapper stays a row (upstream `group/body relative flex
 * w-full pt-p3`). Every other body stacks its children in a column.
 */
const ROW_BODY_TOOLS = new Set(["Bash"]);

/**
 * Card-style tools whose body is source code. Upstream sits those on the page
 * color (`epitaxy-code-card`) instead of leaving them transparent; Bash, whose
 * body is terminal output, keeps the transparent card.
 */
const CODE_CARD_TOOLS = new Set(["Read", "Edit", "MultiEdit", "Write"]);

/**
 * Tools upstream claude.ai/code draws as a bare label row: no chevron, no
 * aria-expanded, no disclosure -- clicking one does nothing. Their body (when
 * we still have something worth showing) renders inline, always visible.
 */
const NON_EXPANDING_TOOLS = new Set(["EnterPlanMode"]);

/** Task tools draw upstream's checklist; a call whose list is empty has nothing to disclose. */
const TASK_CHECKLIST_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskStop"]);

function rendersEmptyBody(call: ClientToolCall): boolean {
	return TASK_CHECKLIST_TOOLS.has(call.name) && taskChecklist(call.name, call.input).length === 0;
}

/** Tools that show inline diff stats (+N -M) in the clickable row. */
const DIFF_STAT_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);

/**
 * A row's diff stat, counted as the group header counts it. Upstream draws none
 * on a call that failed, since it changed nothing, nor on one that changed no lines.
 */
function useEditDiffStats(call: ClientToolCall): {added: number; removed: number} | null {
	return useMemo(() => {
		if (!DIFF_STAT_TOOLS.has(call.name) || call.isError === true) return null;
		const stats = diffStatsForCall(call);
		return stats.added === 0 && stats.removed === 0 ? null : stats;
	}, [call]);
}

/** A call whose tool_result has not arrived yet. */
function isPendingToolCall(call: ClientToolCall): boolean {
	return call.resultUuid === undefined && call.result === undefined && call.isError !== true;
}

/** An in-flight row's live elapsed time, in muted ink after its label. */
function RunningElapsed({startedAt}: {startedAt: string | undefined}) {
	const seconds = useElapsedSeconds(startedAt);
	if (seconds === null || seconds < ELAPSED_MIN_SECONDS) return null;
	return (
		<span data-running-elapsed="" className="shrink-0 text-body text-ink-muted tabular-nums">
			{formatElapsed(seconds)}
		</span>
	);
}

/**
 * A row label span in `ink`, or upstream's ShimmerText when the ink is null (the
 * label of an in-flight call).
 */
function InkedLabel({
	className,
	ink,
	id,
	children,
}: {
	className: string;
	ink: string | null;
	id?: string;
	children: ReactNode;
}) {
	if (ink === null)
		return (
			<ShimmerText {...(className === "" ? {} : {className})} {...(id === undefined ? {} : {id})}>
				{children}
			</ShimmerText>
		);
	return (
		<span id={id} className={className === "" ? ink : `${className} ${ink}`}>
			{children}
		</span>
	);
}

/**
 * Upstream wraps each status disclosure in a TurnStatus with a static -4px
 * vertical outset (-my-pad-xs) in every state. The frame pads that outset back
 * so it stays inside the transcript row's measured box. A status that opens a
 * reply keeps its top outset, rising into the reply boundary to sit 2px under
 * the prompt as upstream's does.
 */
function TurnStatusFrame({leading, children}: {leading: boolean; children: React.ReactNode}) {
	return (
		<div data-turn-status-frame="" className={`flex flex-col w-full ${leading ? "pb-p3" : "py-p3"}`}>
			{children}
		</div>
	);
}

/** Class of the status wrapper a TurnStatusFrame pads back. */
const TURN_STATUS_CLASS = "flex flex-col w-full -my-p3";

function ToolCallRow({
	call,
	sessionId,
	nested = false,
	leading = false,
}: {
	call: ClientToolCall;
	sessionId: string;
	nested?: boolean;
	/** The row is the first thing drawn in the transcript row that opens a reply. */
	leading?: boolean;
}) {
	const [expanded, toggleExpanded] = useModeExpansion(`row:${call.id}`);
	const bodyId = useId();
	const statusId = useId();
	const verbose = useContext(TranscriptModeContext) === "verbose";
	const openSubagent = useSubagentOpener();
	const isAgent = call.name === "Agent";
	// An Agent row whose subagent resolves opens the Subagent pane on it rather
	// than expanding inline, as upstream does.
	const paneAgentId = isAgent && openSubagent !== null ? call.subagentInfo?.agentId : undefined;
	const hasBody = !rendersEmptyBody(call);
	// An artifact card is the row's whole body and stays visible, as upstream
	// draws it under the "Published artifact" label.
	const expandable = hasBody && !NON_EXPANDING_TOOLS.has(call.name) && !isArtifactCard(call);
	const Renderer = getCallRenderer(call);
	const pending = isPendingToolCall(call);
	const resolveAgentName = useContext(AgentNameContext);
	const labelCall =
		call.name === "SendMessage" && typeof call.input["to"] === "string"
			? {...call, recipientDescription: resolveAgentName(call.input["to"])}
			: call;
	const toolRowLabel = toolLabel(labelCall);
	const permissionWaitId = useContext(PermissionWaitContext);
	// Upstream offers a running background command's live output; locally that is the Background tasks pane.
	const backgroundTasks = useBackgroundTasksOpener();
	// A background Agent's launch result arrives at once, but upstream keeps its row
	// busy, in the present tense, until the task's completion notification lands.
	const busyAgent = isAgent && (pending || backgroundTasks?.running.has(call.id) === true);
	const busy = pending || busyAgent;
	const running = busy ? runningToolLabel(withPermissionWait(labelCall, permissionWaitId)) : null;
	const isFileParam = FILE_PARAM_TOOLS.has(call.name);
	const diffStats = useEditDiffStats(call);
	const isCardStyle = CARD_STYLE_TOOLS.has(call.name) && !nested;
	const isCodeCard = CODE_CARD_TOOLS.has(call.name);
	// Renderers that draw nothing leave no padded gap.
	const bodyClass =
		// Upstream opens a grouped row's body 10px below its header line.
		(nested && ROW_BODY_TOOLS.has(call.name)
			? "group/body relative flex w-full pt-2.5"
			: `group/body relative flex w-full flex-col ${nested ? "pt-2.5" : "pt-p3"}`) + " empty:hidden";
	// Collapsed rows recede to muted ink and lift to secondary on hover; an open
	// row stays secondary, as upstream does.
	const ink = expanded ? "text-secondary" : "text-ink-muted group-hover/tool:text-secondary";
	// A settled Skill row reads "Ran skill" in secondary ink beside a primary
	// skill name, as upstream draws it.
	const isSkill = call.name === "Skill" && !call.isError && !pending;
	const isFailedSkill = call.name === "Skill" && call.isError === true;
	// Upstream keeps a failed or stopped row's success-shaped label in muted ink and
	// appends a status: a danger "Failed", a secondary "Stopped" when the user
	// rejected or interrupted the call, or a secondary "Denied" when they rejected
	// it with a reply.
	// A background launch takes the status its later notification reports.
	const backgroundOutcome = useContext(BackgroundOutcomeContext).byLaunch.get(call.id);
	const status =
		call.isError === true
			? call.stopped === true
				? "Stopped"
				: call.denied === true
					? "Denied"
					: "Failed"
			: backgroundOutcome === "stopped"
				? "Stopped"
				: backgroundOutcome === "failed"
					? "Failed"
					: null;
	// A null ink marks an in-flight label, which upstream draws as ShimmerText.
	const labelClass = call.isError ? ink : busy ? null : isSkill ? "text-secondary" : ink;
	const isCompletedPaneAgent = paneAgentId !== undefined && !call.isError && !busy;
	// Expandable rows reach the disclosure below; Agent navigation and nested rows are not statuses.
	// Upstream draws every standalone status row in one 24px padded layout, whether it
	// completed, failed, or is still running.
	const isTurnStatus = !isAgent && !nested;
	const disclosureLayout = isTurnStatus ? "min-w-0 self-stretch me-[52px] px-1 py-0.5" : "self-start py-0";
	const paramClass = isSkill || isCompletedPaneAgent ? "text-primary" : isFailedSkill ? "text-secondary" : labelClass;
	// A subagent row's chevron sits in the flat `t6` token upstream gives it,
	// rather than the hover-reactive ink every other tool row uses.
	// Upstream's 6px row gap less the chevron's -4px start margin leaves its 12px
	// svg 2px from the status.
	const chevronClass = isAgent ? "shrink-0 -ms-1 self-center text-t6" : `shrink-0 -ms-1 ${ink}`;
	// A failed call whose param is its own description keeps that description as
	// written ("Rebase and push X"); upstream past-tenses it only on success.
	const failedDescription = status === null ? null : getToolDescription(call.name, call.input);
	const phrase =
		failedDescription ??
		(isAgent && (nested || !busy)
			? null
			: running === null
				? (toolRowLabel.doneLabel ?? null)
				: (running.label ?? null));
	const label = phrase ?? running?.verb ?? toolRowLabel.verb;
	// A label that is a whole phrase owns the row and truncates; a bare verb
	// keeps its width so the param beside it truncates instead.
	const isPhraseLabel = phrase !== null;

	const displayParam =
		RENDERER_HANDLES_PARAM.has(call.name) || PARAMLESS_TOOLS.has(call.name) || isPhraseLabel
			? ""
			: isFileParam
				? (call.param.split("/").pop() ?? call.param)
				: (toolRowLabel.meta ?? call.param);
	const paramHref = displayParam === toolRowLabel.meta ? toolRowLabel.metaHref : undefined;
	const paramIsCode = displayParam === toolRowLabel.meta && toolRowLabel.metaIsCode === true && !isFailedSkill;
	const rangeLabel = displayParam ? readRangeLabel(call) : null;
	// What allowed or blocked the call is a diagnostic upstream never shows, so only Verbose names it.
	const permissionLabel = verbose && call.permission !== undefined ? permissionDecisionLabel(call.permission) : null;

	// Upstream leads a standalone in-flight row with its activity WorkingMark and follows the label with the elapsed time.
	const runningRow = pending && isTurnStatus;
	const liveOutput =
		backgroundTasks !== null && call.name === "Bash" && backgroundTasks.running.has(call.id)
			? backgroundTasks.open
			: null;
	const paramInk = isFileParam ? "text-primary" : paramHref ? "text-secondary" : paramClass;
	const paramContent = (
		<>
			{paramHref ? (
				<a
					href={paramHref}
					target="_blank"
					rel="noopener noreferrer"
					onClick={(e) => {
						e.stopPropagation();
					}}
					className="underline decoration-[color-mix(in_srgb,currentColor_65%,transparent)] underline-offset-[3px]"
				>
					<bdi>{displayParam}</bdi>
					<span className="sr-only">(opens in new tab)</span>
				</a>
			) : paramIsCode ? (
				<code className="font-mono">{displayParam}</code>
			) : (
				displayParam
			)}
		</>
	);
	const joinedLabel = nested && label !== "" && displayParam !== "";
	// Upstream names a status toggle by its label, its outcome and an sr "running"
	// while busy, and announces the label and outcome in a polite live region.
	const labelledBy = [
		...(joinedLabel || label !== "" ? [`${statusId}-label`] : []),
		...(!joinedLabel && displayParam !== "" ? [`${statusId}-meta`] : []),
		...(rangeLabel ? [`${statusId}-range`] : []),
		...(status === null ? [] : [`${statusId}-outcome`]),
		...(busy ? [`${statusId}-busy`] : []),
	].join(" ");
	const announcement = [label, displayParam, rangeLabel ?? "", status ?? ""].filter((part) => part !== "").join(" ");
	const announcer = isTurnStatus ? (
		<span className="sr-only" role="status" aria-live="polite">
			{announcement}
		</span>
	) : null;
	const rowLabel = (
		<>
			{runningRow && <WorkingMark activity={toolMarkActivity(call.name, call.input)} className="me-1.5" />}
			{joinedLabel ? (
				// Upstream's grouped row: label and parameter in one <bdi>, joined by a plain space.
				<bdi id={`${statusId}-label`} className="truncate min-w-0 text-body">
					<InkedLabel className="" ink={labelClass}>
						{label}
					</InkedLabel>{" "}
					<InkedLabel className="" ink={paramInk}>
						{paramContent}
					</InkedLabel>
				</bdi>
			) : (
				<>
					{label && (
						<InkedLabel
							id={`${statusId}-label`}
							className={`${isPhraseLabel ? "truncate min-w-0" : "shrink-0"} text-body`}
							ink={labelClass}
						>
							{label}
						</InkedLabel>
					)}
					{displayParam &&
						(isFileParam ? (
							<span id={`${statusId}-meta`} className="text-body text-primary truncate min-w-0">
								{paramContent}
							</span>
						) : (
							<InkedLabel id={`${statusId}-meta`} className="truncate min-w-0 text-body" ink={paramInk}>
								{paramContent}
							</InkedLabel>
						))}
				</>
			)}
			{rangeLabel &&
				(labelClass === null ? (
					<ShimmerText id={`${statusId}-range`} className="text-body truncate min-w-0">
						{rangeLabel}
					</ShimmerText>
				) : (
					<span id={`${statusId}-range`} className={`text-body ${labelClass} truncate min-w-0`}>
						{rangeLabel}
					</span>
				))}
			{runningRow && <RunningElapsed startedAt={call.startedAt} />}
			{busy && (
				<span id={`${statusId}-busy`} className="sr-only">
					running
				</span>
			)}
			{liveOutput !== null && (
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						liveOutput();
					}}
					className="shrink-0 cursor-pointer rounded-r3 text-[13px]/[19px] text-primary underline-offset-[3px] hover:underline"
				>
					View live output
				</button>
			)}
			{diffStats && <DiffStatPill added={diffStats.added} removed={diffStats.removed} />}
			{status !== null && (
				<span
					id={`${statusId}-outcome`}
					className={`shrink-0 text-body ${status === "Failed" ? "text-danger-ink" : "text-secondary"}`}
				>
					{status}
				</span>
			)}
			{permissionLabel !== null && call.permission !== undefined && (
				<span
					data-permission-decision=""
					title={permissionDecisionTitle(call.permission)}
					className="shrink-0 text-body text-t6"
				>
					{permissionLabel}
				</span>
			)}
		</>
	);

	const body = hasBody ? (
		isCardStyle ? (
			<div className="group/body py-p6">
				<div
					className={`card-outline ${isCodeCard ? "code-card " : ""}rounded-r6 overflow-clip flex flex-col relative`}
				>
					<Suspense fallback={null}>
						<Renderer toolCall={call} verbose={verbose} />
					</Suspense>
					<DebugLink sessionId={sessionId} uuid={call.sourceUuid} className="absolute top-1 right-1" />
				</div>
			</div>
		) : (
			<div className={bodyClass}>
				<Suspense fallback={null}>
					<Renderer toolCall={call} nested={nested} verbose={verbose} />
				</Suspense>
			</div>
		)
	) : null;

	if (paneAgentId !== undefined && openSubagent !== null) {
		const open = () => {
			openSubagent(paneAgentId);
		};
		return (
			<div
				data-tool-row=""
				data-completed-agent-row={isCompletedPaneAgent && !nested ? "" : undefined}
				className="flex flex-col w-full"
			>
				<div
					role="button"
					tabIndex={0}
					aria-labelledby={labelledBy}
					data-state={busyAgent ? "busy" : undefined}
					data-transcript-keeps-pin=""
					onClick={open}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							open();
						}
					}}
					className={`relative group/tool flex max-w-full items-center ${isCompletedPaneAgent && !nested ? "min-w-0 self-stretch me-[52px] px-1 py-0.5 gap-1.5" : "self-start py-0 gap-g5"} text-left cursor-pointer outline-none hide-focus-ring focus-visible:ring-focus rounded-r3`}
				>
					{rowLabel}
				</div>
			</div>
		);
	}

	if (!expandable) {
		return (
			<div data-tool-row="" className="flex flex-col w-full">
				<div
					data-state={busyAgent ? "busy" : undefined}
					className="relative group/tool flex self-start max-w-full items-center py-0 gap-g5 text-left"
				>
					{rowLabel}
				</div>
				{body}
				{announcer}
			</div>
		);
	}

	const disclosure = (
		<div
			data-tool-row=""
			data-turn-status={isTurnStatus ? "" : undefined}
			data-standalone-tool-row={isTurnStatus ? "" : undefined}
			className={isTurnStatus ? TURN_STATUS_CLASS : "flex flex-col w-full"}
		>
			<div
				role="button"
				tabIndex={0}
				aria-expanded={expanded}
				aria-controls={bodyId}
				aria-labelledby={labelledBy}
				data-state={busyAgent ? "busy" : undefined}
				onClick={toggleExpanded}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						toggleExpanded();
					}
				}}
				className={`relative group/tool flex max-w-full items-center ${disclosureLayout} gap-g5 text-left cursor-pointer outline-none hide-focus-ring focus-visible:ring-focus rounded-r3`}
			>
				{rowLabel}
				<span className={chevronClass}>
					<ChevronIcon expanded={expanded} size={12} />
				</span>
			</div>
			{expanded && (
				<div id={bodyId} className="flow-root">
					{body}
				</div>
			)}
			{announcer}
		</div>
	);
	return isTurnStatus ? <TurnStatusFrame leading={leading}>{disclosure}</TurnStatusFrame> : disclosure;
}

/**
 * Renders the structured summary as verb spans matching upstream claude.ai/code:
 *   <span class="text-body">{verb}</span>
 *   <span> {rest}</span>
 * with commas between segments; the color comes from the hover-aware wrapper.
 */
function SummarySpans({segments}: {segments: SummarySegment[]}) {
	return (
		<>
			{segments.map((segment, i) => (
				<React.Fragment key={i}>
					{i > 0 && <span>, </span>}
					<span className="text-body">{segment.verb}</span>
					{segment.rest && <span> {segment.rest}</span>}
				</React.Fragment>
			))}
		</>
	);
}

function ToolCallSummary({
	calls,
	sessionId,
	notices = NO_NOTICES,
	leading,
}: {
	calls: ClientToolCall[];
	sessionId: string;
	notices?: readonly FoldedNotice[];
	leading: boolean;
}) {
	const [expanded, toggleExpanded] = useModeExpansion(`group:${calls[0]?.id ?? `notice-${notices[0]?.lineIndex}`}`);
	const bodyId = useId();
	const statusId = useId();
	const backgroundOutcomes = useContext(BackgroundOutcomeContext);
	const {taskNotices, leadingPeers, trailingPeers, hooks} = useMemo(() => splitNotices(notices), [notices]);
	const summary = useMemo(
		() =>
			summarizeToolCallStats(
				calls,
				[...taskNotices.map((notice) => notice.notification), ...stopCompletions(calls, backgroundOutcomes)],
				failedLaunchIds(backgroundOutcomes),
				{leading: leadingPeers.length, trailing: trailingPeers.length, reprompted: hooks.length > 0},
			),
		[calls, taskNotices, leadingPeers, trailingPeers, hooks, backgroundOutcomes],
	);
	// While a call is in flight, upstream names the group by that call's
	// progressive label instead of the tally.
	// oxlint-disable-next-line unicorn/prefer-array-find -- findLast is not in the ES2022 lib
	const pendingCall = calls.findLast(isPendingToolCall);
	const permissionWaitId = useContext(PermissionWaitContext);
	const runningText =
		pendingCall === undefined
			? null
			: runningToolLabelText(runningToolLabel(withPermissionWait(pendingCall, permissionWaitId)));
	// A failed completion leads only when its launch is outside the group; a
	// launch inside it takes the failure, so its notice trails like any other.
	const leadsLabel = (notice: BackgroundNotice) =>
		notice.notification.status === "failed" && !calls.some((call) => call.id === notice.notification.toolUseId);
	const failedNotices = taskNotices.filter(leadsLabel);
	const settledNotices = taskNotices.filter((notice) => !leadsLabel(notice));
	// Upstream draws the grouped header in one 24px padded row whether it completed, failed, or is still running.
	const summaryLayout = "min-w-0 self-stretch me-[52px] px-1 py-0.5";
	// Collapsed rows recede to muted ink and lift to secondary on hover; an open
	// row stays secondary, as upstream does.
	const ink = expanded ? "text-secondary" : "text-ink-muted group-hover/tool:text-secondary";
	const busy = pendingCall !== undefined && runningText !== null;
	const announcement = busy
		? runningText
		: summary.segments
				.map((segment) => (segment.rest ? `${segment.verb} ${segment.rest}` : segment.verb))
				.join(", ");

	const status = (
		<div data-tool-row="" data-turn-status="" className={TURN_STATUS_CLASS}>
			{(calls.length > 0 || notices.length > 0) && (
				<>
					<button
						type="button"
						aria-expanded={expanded}
						aria-controls={bodyId}
						aria-labelledby={busy ? `${statusId}-label ${statusId}-busy` : `${statusId}-label`}
						onClick={toggleExpanded}
						className={`relative group/tool flex max-w-full items-center ${summaryLayout} gap-g1 text-left cursor-pointer outline-none hide-focus-ring focus-visible:ring-focus rounded-r3`}
					>
						<span className={`inline-flex items-center gap-g3 min-w-0 ${ink}`}>
							{busy ? (
								// Upstream leads a busy group header like a busy row: the call's mark, its label, elapsed, sr "running".
								<>
									<WorkingMark
										activity={toolMarkActivity(pendingCall.name, pendingCall.input)}
										className="me-1.5"
									/>
									<ShimmerText id={`${statusId}-label`} className="text-body truncate min-w-0">
										{runningText}
									</ShimmerText>
									<RunningElapsed startedAt={pendingCall.startedAt} />
									<span id={`${statusId}-busy`} className="sr-only">
										running
									</span>
								</>
							) : (
								<span id={`${statusId}-label`} className="text-body truncate min-w-0">
									<SummarySpans segments={summary.segments} />
								</span>
							)}
						</span>
						{hasDiffStats(summary) && <DiffStatPill added={summary.added} removed={summary.removed} />}
						<span className={`shrink-0 ${ink}`}>
							<ChevronIcon expanded={expanded} size={12} />
						</span>
					</button>
					{expanded && (
						<div id={bodyId} className="flow-root">
							{/* Upstream separates the grouped rows with hairline dividers and
                  per-child padding inside one outlined card, not with gaps
                  between rows floating on a tinted panel. */}
							<div className="flex flex-col card-outline rounded-r7 overflow-clip mt-p6 divide-y [&>*]:px-2 [&>*]:py-1.5">
								{/* Upstream lists failed completions first, as the group label leads with them. */}
								{failedNotices.map((notice, index) => (
									<BackgroundNoticeRow key={`notice-${notice.lineIndex}-${index}`} notice={notice} />
								))}
								{hooks.map((notice) => (
									<StopHookMarker key={`notice-${notice.lineIndex}`} line={notice.line} />
								))}
								{leadingPeers.map((notice) => (
									<AgentMessageRow key={`notice-${notice.lineIndex}`} message={notice.message} />
								))}
								{calls.map((call, i) => (
									<ToolCallRow key={i} call={call} sessionId={sessionId} nested />
								))}
								{trailingPeers.map((notice) => (
									<AgentMessageRow key={`notice-${notice.lineIndex}`} message={notice.message} />
								))}
								{settledNotices.map((notice, index) => (
									<BackgroundNoticeRow key={`notice-${notice.lineIndex}-${index}`} notice={notice} />
								))}
							</div>
						</div>
					)}
					<span className="sr-only" role="status" aria-live="polite">
						{announcement}
					</span>
				</>
			)}
		</div>
	);
	return <TurnStatusFrame leading={leading}>{status}</TurnStatusFrame>;
}
