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
} from "react";
import {AlertTriangle, Bot, FileWarning, GitBranch, Lock, Palette, Plug, Zap} from "lucide-react";
import {assertNever} from "../lib/assert-never";
import {ProseMarkdown} from "./file-refs";
import {MarkdownArticle} from "./markdown-article";
import {TruncatedContent} from "./truncated-content";
import {AgentMessageRow, AgentNameContext, type AgentNameResolver} from "./agent-message-row";
import {parseAgentMessage} from "../lib/agent-message";
import {parseTaskNotification, type TaskNotification} from "../lib/background-tasks";
import {SlashCommandText, SlashCommandsContext} from "./slash-command-chip";
import {UserPlainText} from "./user-plain-text";
import {splitLeadingSlashCommand, type SlashCommand} from "../lib/slash-commands";
import {getToolRenderer} from "./tool-renderers";
import {buildClientToolCall, buildSubagentLookup, getToolDescription, isArtifactCard} from "./tool-renderers/types";
import type {ClientToolCall} from "./tool-renderers";
import type {LiveToolFailure, SubagentLookup} from "./tool-renderers/types";
import type {Subagent} from "../lib/subagents";
import {useSubagentOpener} from "./subagent-opener";
import {useClaudeEvents} from "../hooks/use-claude-events";
import {ChevronIcon, CollapsibleSection, CopyButton, DiffStats, TerminalOutput} from "./tool-renderers/shared";
import {SystemBanner} from "./system-banner";
import {ArtifactLinkBanner, ArtifactWatchBanner} from "./artifact-banner";
import {computeDiffData} from "../lib/diff-utils";
import {TasksView} from "./tasks-view";
import {DebugLink} from "./debug-link";
import {type TranscriptMessageRef, TranscriptMessageMenu} from "./transcript-context-menu";
import {AssistantMessageActions, UserMessageActions} from "./message-actions";
import {messageText} from "../lib/transcript-action-targets";
import {assistantTurnDetails, userTurnDetails} from "../lib/turn-metadata";
import {TurnChangesCard} from "./turn-changes-card";
import {collectTurnChanges, type TurnChanges} from "../lib/turn-changes";
import {useSettings} from "./settings-provider";
import type {TranscriptMode} from "../lib/transcript-mode";
import {hmrPersist} from "../lib/hmr-persist";
import type {MessageSessionLine, SessionLine, SessionContentBlock, ToolResultInfo} from "../lib/sessions";
import type {ToolUseBlock} from "../lib/schemas";
import {AttachmentBanner, Banner, Pre} from "./attachment-banner";
import {
	stripCommandTags,
	parseCommandBlock,
	parseBashInput,
	parseBashOutput,
	hasDiffStats,
	summarizeToolCallStats,
	editDiffEntries,
	isRequestInterrupted,
} from "../lib/session-utils";
import type {SummarySegment} from "../lib/session-utils";
import {failedDescriptionLabel, runningToolLabel, runningToolLabelText, toolLabel} from "../lib/tool-labels";
import {InlinePathImages, SESSION_IMAGE_CLASS_NAME} from "./inline-path-images";
import {findScrollContainer} from "./transcript-history-loader";
import {usePromptJump} from "../hooks/use-prompt-jump";
import {CHAT_COLUMN_CLASS} from "../lib/transcript-width";
import {jumpToMessage, TRANSCRIPT_JUMP_REQUEST_EVENT, type TranscriptJumpRequestEvent} from "../lib/jump-to-message";

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
	shouldScrollToEnd?: boolean;
	/** The AI summary, shown once as a muted subtitle before the first message. */
	summary?: string | null;
	/** Commands known for this project, so a slash-command chip can show its description. */
	slashCommands?: readonly SlashCommand[];
}

const TranscriptModeContext = createContext<TranscriptMode>("normal");

interface ExpansionToggle {
	mode: TranscriptMode;
	expanded: boolean;
}

/**
 * The session's disclosure toggles keyed by tool_use id, so a row the virtualizer unmounts
 * comes back in the state the user left it.
 */
const ExpansionStoreContext = createContext<Map<string, ExpansionToggle> | null>(null);

/**
 * A disclosure that starts expanded in Verbose and collapsed otherwise, like upstream. A user
 * toggle holds until the transcript mode changes, which resets it to the new mode's default.
 */
function useModeExpansion(key: string): [boolean, () => void] {
	const mode = useContext(TranscriptModeContext);
	const store = useContext(ExpansionStoreContext);
	const [toggle, setToggle] = useState<ExpansionToggle | null>(() => store?.get(key) ?? null);
	const expanded = toggle !== null && toggle.mode === mode ? toggle.expanded : mode === "verbose";
	const flip = useCallback(() => {
		const next = {mode, expanded: !expanded};
		store?.set(key, next);
		setToggle(next);
	}, [mode, expanded, store, key]);
	return [expanded, flip];
}

const autoScrolledLocations = hmrPersist("autoScrolledLocations", () => new Set<string>());
const EMPTY_IMAGE_ROOTS: readonly string[] = [];
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

function UserTurnActions({line, sessionId}: {line: MessageSessionLine; sessionId: string}) {
	return (
		<UserMessageActions
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
	subagents = [],
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
	shouldScrollToEnd = true,
	summary = null,
	slashCommands = EMPTY_SLASH_COMMANDS,
}: SessionChatProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const endRef = useRef<HTMLDivElement>(null);
	const isSubagentSession = sessionId.startsWith("agent-");
	const subagentLookup = useMemo(() => buildSubagentLookup(subagents), [subagents]);
	const resolveAgentName = useCallback<AgentNameResolver>(
		(agentId) => subagentLookup.byBareId.get(agentId)?.description ?? null,
		[subagentLookup],
	);

	useEffect(() => {
		if (!shouldScrollToEnd || autoScrolledLocations.has(initialScrollKey)) return;

		let followsEnd = false;
		let initialFrame: number | undefined;
		let paintedFrame: number | undefined;
		let resizeFrame: number | undefined;

		const updateFollowsEnd = () => {
			const scroller = findScrollContainer(containerRef.current);
			const {scrollHeight, scrollTop, clientHeight} = scrollMetrics(scroller);
			const distanceFromEnd = scrollHeight - scrollTop - clientHeight;
			followsEnd = distanceFromEnd <= END_FOLLOW_THRESHOLD_PIXELS;
		};

		const resizeObserver = new ResizeObserver(() => {
			if (!followsEnd || resizeFrame !== undefined) return;
			resizeFrame = requestAnimationFrame(() => {
				resizeFrame = undefined;
				if (!followsEnd) return;
				const scroller = findScrollContainer(containerRef.current);
				const {scrollHeight} = scrollMetrics(scroller);
				if (isDocumentScrollContainer(scroller)) window.scrollTo({top: scrollHeight});
				else scroller.scrollTo({top: scrollHeight});
			});
		});
		const container = containerRef.current;
		if (!container) throw new Error("Expected the session chat container to be mounted.");
		const scroller = findScrollContainer(container);
		const scrollEventTarget = isDocumentScrollContainer(scroller) ? window : scroller;
		resizeObserver.observe(container);
		scrollEventTarget.addEventListener("scroll", updateFollowsEnd, {passive: true});

		initialFrame = requestAnimationFrame(() => {
			paintedFrame = requestAnimationFrame(() => {
				const end = endRef.current;
				if (!end) return;
				autoScrolledLocations.add(initialScrollKey);
				end.scrollIntoView({block: "end"});
				followsEnd = true;
			});
		});

		return () => {
			resizeObserver.disconnect();
			scrollEventTarget.removeEventListener("scroll", updateFollowsEnd);
			if (initialFrame !== undefined) cancelAnimationFrame(initialFrame);
			if (paintedFrame !== undefined) cancelAnimationFrame(paintedFrame);
			if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
		};
	}, [initialScrollKey, shouldScrollToEnd]);

	return (
		<TranscriptModeContext.Provider value={transcriptMode}>
			<SlashCommandsContext.Provider value={slashCommands}>
				<AgentNameContext.Provider value={resolveAgentName}>
					<div ref={containerRef} className={`${CHAT_COLUMN_CLASS} pt-4 pb-4 text-body transcript-text`}>
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
							lines={lines}
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
						/>
						<div ref={endRef} />
					</div>
				</AgentNameContext.Provider>
			</SlashCommandsContext.Provider>
		</TranscriptModeContext.Provider>
	);
});

/**
 * Build a set of line indices that should be skipped because they've been
 * coalesced into a preceding line (e.g., bash-output following bash-input).
 */
function buildSkipSet(lines: SessionLine[]): Set<number> {
	const skip = new Set<number>();
	for (let i = 0; i < lines.length - 1; i++) {
		const line = lines[i]!;
		const next = lines[i + 1]!;
		if (line.type === "user" && next.type === "user" && hasBashInput(line) && hasBashOutput(next)) {
			skip.add(i + 1);
		}
	}
	return skip;
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

/** How many characters of a turn its screen-reader heading quotes, as upstream does. */
const TURN_HEADING_PREVIEW_LENGTH = 80;

/**
 * Upstream claude.ai/code opens every turn wrapper with a visually hidden
 * heading quoting the turn ("You said: ..." / "Claude responded: ..."), giving
 * screen readers a heading list to navigate the transcript turn by turn. It is
 * hidden from sight and from text selection, so copying a turn never picks it up.
 */
function TurnHeading({speaker, text}: {speaker: "user" | "assistant"; text: string}) {
	const prefix = speaker === "user" ? "You said" : "Claude responded";
	const preview = text.replace(/\s+/g, " ").trim().slice(0, TURN_HEADING_PREVIEW_LENGTH);
	return <h2 className="sr-only select-none">{preview === "" ? prefix : `${prefix}: ${preview}`}</h2>;
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
	...renderProps
}: LineRenderProps & {
	line: SessionLine;
	nextLine: SessionLine | undefined;
	className?: string;
	/** The end-of-turn changes card this line closes, shown after its content. */
	turnChanges?: TurnChanges | undefined;
}) {
	const content = renderSessionMessage({
		line,
		...renderProps,
		nextLine,
	});
	if (!content) return null;

	const isAssistant = line.type === "assistant";
	const wrapperClassName = [
		isAssistant ? "group/msg flex flex-col w-full" : "group relative",
		TURN_GAP_CLASS,
		className,
	]
		.filter(Boolean)
		.join(" ");
	const wrapper = (
		<div key={`line-${line.lineIndex}`} data-record-index={line.lineIndex} className={wrapperClassName} />
	);
	const children = (
		<>
			{line.type === "assistant" && <TurnHeading speaker="assistant" text={messageText(line)} />}
			{content}
			{turnChanges && <TurnChangesCard sessionId={renderProps.sessionId} changes={turnChanges} />}
			{isAssistant && <AssistantTurnActions line={line} sessionId={renderProps.sessionId} />}
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
	return content
		.filter((b): b is ToolUseBlock => b.type === "tool_use")
		.map((block) => buildClientToolCall(block, line.uuid ?? "", toolResultMap, liveFailures, subagentLookup));
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
	sessionId,
	toolResultMap,
	subagentLookup,
}: {
	entries: SessionLine[];
	/** Background-task completions folded into the run, shown with its last batch. */
	notices: readonly BackgroundNotice[];
	sessionId: string;
	toolResultMap: Map<string, ToolResultInfo>;
	subagentLookup: SubagentLookup;
}) {
	const liveFailures = useLiveToolFailures(sessionId);
	const batches = useMemo(() => {
		const result: ToolCallBatch[] = [];
		let openBatch: ToolCallBatch | undefined;
		for (const line of entries) {
			if (line.type !== "assistant") continue;
			const calls = buildLineToolCalls(line, toolResultMap, liveFailures, subagentLookup);
			if (calls.length === 0) continue;
			const sourceSessionId = getSourceSessionId(line, sessionId);
			if (openBatch !== undefined && openBatch.sourceSessionId === sourceSessionId) {
				openBatch.calls.push(...calls);
				continue;
			}
			openBatch = {head: line, sourceSessionId, calls};
			result.push(openBatch);
		}
		return result;
	}, [entries, sessionId, toolResultMap, liveFailures, subagentLookup]);

	if (batches.length === 0) return notices.length === 0 ? null : <BackgroundNoticeRows notices={notices} />;

	return (
		<div className={`group/msg flex flex-col w-full gap-[var(--chat-item-gap)] ${TURN_GAP_CLASS}`}>
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
					/>
				</TranscriptMessageMenu>
			))}
		</div>
	);
}

/** A `<task-notification>` user turn folded into the tool group beside it. */
interface BackgroundNotice {
	lineIndex: number;
	notification: TaskNotification;
}

const NO_NOTICES: readonly BackgroundNotice[] = [];

/** The finished background task a user line announces, or null for any other line. */
function taskNotificationOf(line: SessionLine): TaskNotification | null {
	if (line.type !== "user") return null;
	return parseTaskNotification(getUserContentText(line));
}

/** Upstream's static group sub-row: "Background task stopped · <description>". */
function BackgroundNoticeRow({notice}: {notice: BackgroundNotice}) {
	const {status, description} = notice.notification;
	return (
		<div data-record-index={notice.lineIndex} className="text-body text-secondary min-w-0 truncate">
			{description === "" ? `Background task ${status}` : `Background task ${status} · ${description}`}
		</div>
	);
}

/** Notifications with no tool group to join, drawn as the same static rows. */
function BackgroundNoticeRows({notices}: {notices: readonly BackgroundNotice[]}) {
	return (
		<div className={`flex flex-col w-full gap-[var(--chat-item-gap)] ${TURN_GAP_CLASS}`}>
			{notices.map((notice) => (
				<BackgroundNoticeRow key={notice.lineIndex} notice={notice} />
			))}
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
			className="flex self-start max-w-full items-center gap-g2 text-left outline-none hide-focus-ring focus:ring-focus rounded-r3"
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
				onToggle={() => setExpanded(!expanded)}
			/>
			{expanded && (
				<div id={bodyId} className="flow-root">
					<div className="flex flex-col pt-p6">
						{indices.map((index) => (
							<LineEntry
								key={`line-${index}`}
								line={lines[index]!}
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

/** Prominent question cards split tool runs so summaries cannot reorder their answers. */
function isGroupableToolOnlyAssistantLine(line: SessionLine): boolean {
	if (line.type !== "assistant") return false;
	const content = line.message?.content;
	if (!Array.isArray(content) || content.length === 0) return false;
	return content.every(
		(b) =>
			(b.type === "tool_use" && !PROMINENT_TOOLS.has(b.name)) ||
			(b.type === "text" && (typeof b.text !== "string" || b.text.trim() === "")),
	);
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
	if (line.type !== "assistant") return "marker";
	const content = line.message?.content;
	if (!Array.isArray(content))
		return typeof content === "string" && content.trim() !== "" ? "assistant_text" : "assistant";
	if (content.some((b) => b.type === "text" && typeof b.text === "string" && b.text.trim() !== ""))
		return "assistant_text";
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
	element: React.ReactNode;
}

const PROMPT_KINDS: ReadonlySet<UserContentKind> = new Set(["text", "command", "bash"]);

function isPromptLine(line: SessionLine): boolean {
	return line.type === "user" && PROMPT_KINDS.has(classifyUserContent(line));
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

function entryIndexAtOffset(prefixHeights: readonly number[], offset: number): number {
	let lower = 0;
	let upper = prefixHeights.length - 1;
	while (lower < upper) {
		const middle = Math.floor((lower + upper + 1) / 2);
		if (prefixHeights[middle]! <= offset) lower = middle;
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

function scrollerViewport(scroller: Element): {top: number; height: number} {
	if (scroller === document.documentElement || scroller === document.scrollingElement) {
		return {top: 0, height: window.innerHeight};
	}
	const rect = scroller.getBoundingClientRect();
	return {top: rect.top, height: scroller.clientHeight || rect.height || window.innerHeight};
}

/**
 * Upstream Normal folds background-task completions into the tool group beside
 * them ("Ran a command, finished a background command") rather than drawing a
 * user turn per `<task-notification>`; Verbose keeps the raw notification turns.
 */
function buildSessionListEntries(
	lines: SessionLine[],
	renderProps: LineRenderProps,
	verbose: boolean,
): SessionListEntry[] {
	const foldNotifications = !verbose;
	const noticeOf = (index: number): BackgroundNotice | null => {
		if (!foldNotifications) return null;
		const line = lines[index]!;
		const notification = taskNotificationOf(line);
		return notification === null ? null : {lineIndex: line.lineIndex, notification};
	};
	const skipSet = buildSkipSet(lines);
	const turnChangesByLine = collectTurnChanges(lines, renderProps.toolResultMap);
	const entries: Omit<SessionListEntry, "endRecordIndex">[] = [];
	let prevVisibleType: string | null = null;
	let i = 0;

	const initIndices: number[] = [];
	while (i < lines.length) {
		const line = lines[i]!;
		if (skipSet.has(i) || !isLineVisible(line, renderProps, verbose)) {
			i++;
			continue;
		}
		if (!SESSION_INIT_LINE_TYPES.has(line.type)) break;
		initIndices.push(i);
		i++;
	}
	if (initIndices.length > 0) {
		entries.push({
			key: "session-init",
			startRecordIndex: lines[initIndices[0]!]!.lineIndex,
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
	let leadingNotices: BackgroundNotice[] = [];

	while (i < lines.length) {
		const line = lines[i]!;

		if (skipSet.has(i) || !isLineVisible(line, renderProps, verbose)) {
			i++;
			continue;
		}

		const notice = noticeOf(i);
		if (notice !== null) {
			const notices = [notice];
			let j = i + 1;
			while (j < lines.length) {
				if (skipSet.has(j) || !isLineVisible(lines[j]!, renderProps, verbose)) {
					j++;
					continue;
				}
				const next = noticeOf(j);
				if (next === null) break;
				notices.push(next);
				j++;
			}
			const following = lines[j];
			if (following !== undefined && isGroupableToolOnlyAssistantLine(following) && renderProps.showTools) {
				leadingNotices = notices;
			} else {
				prevVisibleType = "assistant";
				entries.push({
					key: `notice-${line.lineIndex}`,
					startRecordIndex: line.lineIndex,
					isPrompt: false,
					kind: "assistant_tool",
					element: <BackgroundNoticeRows notices={notices} />,
				});
			}
			i = j;
			continue;
		}

		// Group consecutive tool-only assistant lines
		if (isGroupableToolOnlyAssistantLine(line) && renderProps.showTools) {
			const groupStart = i;
			const groupIndices: number[] = [i];
			const notices = leadingNotices;
			leadingNotices = [];
			const startRecordIndex = notices[0]?.lineIndex ?? line.lineIndex;
			let j = i + 1;
			while (j < lines.length) {
				const nextLine = lines[j]!;
				if (skipSet.has(j) || !isLineVisible(nextLine, renderProps, verbose)) {
					j++;
					continue;
				}
				if (isToolResultOnlyUserLine(nextLine)) {
					j++;
					continue;
				}
				const next = noticeOf(j);
				if (next !== null) {
					notices.push(next);
					j++;
					continue;
				}
				if (isGroupableToolOnlyAssistantLine(nextLine)) {
					groupIndices.push(j);
					j++;
				} else {
					break;
				}
			}

			prevVisibleType = "assistant";

			if (groupIndices.length === 1 && notices.length === 0) {
				entries.push({
					key: `line-${line.lineIndex}`,
					startRecordIndex: line.lineIndex,
					isPrompt: false,
					kind: "assistant_tool",
					element: (
						<LineEntry
							line={line}
							nextLine={lines[groupStart + 1]}
							turnChanges={turnChangesByLine.get(line.lineIndex)}
							{...renderProps}
						/>
					),
				});
			} else {
				const groupLines = groupIndices.map((index) => lines[index]!);
				const groupChanges = groupLines
					.map((groupLine) => turnChangesByLine.get(groupLine.lineIndex))
					.find((changes) => changes !== undefined);
				entries.push({
					key: `group-${line.lineIndex}`,
					startRecordIndex,
					isPrompt: false,
					kind: "assistant_tool",
					element: (
						<>
							<GroupedToolCallEntry entries={groupLines} notices={notices} {...renderProps} />
							{groupChanges && (
								<div className={TURN_GAP_CLASS}>
									<TurnChangesCard sessionId={renderProps.sessionId} changes={groupChanges} />
								</div>
							)}
						</>
					),
				});
			}
			i = j;
			continue;
		}

		const isBannerAfterBanner =
			BANNER_LINE_TYPES.has(line.type) && prevVisibleType !== null && BANNER_LINE_TYPES.has(prevVisibleType);

		prevVisibleType = line.type;

		entries.push({
			key: `line-${line.lineIndex}`,
			startRecordIndex: line.lineIndex,
			isPrompt: isPromptLine(line),
			kind: transcriptRowKind(line),
			element: (
				<LineEntry
					line={line}
					nextLine={lines[i + 1]}
					turnChanges={turnChangesByLine.get(line.lineIndex)}
					{...(isBannerAfterBanner ? {className: "mt-1"} : {})}
					{...renderProps}
				/>
			),
		});
		i++;
	}

	const finalRecordIndex = lines.at(-1)?.lineIndex ?? 0;
	return entries.map((entry, index) => ({
		...entry,
		endRecordIndex: (entries[index + 1]?.startRecordIndex ?? finalRecordIndex + 1) - 1,
	}));
}

function VirtualizedSessionEntries({
	entries,
	shouldScrollToEnd,
}: {
	entries: SessionListEntry[];
	shouldScrollToEnd: boolean;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	const scrollerRef = useRef<Element | null>(null);
	const measuredHeightsRef = useRef(new Map<string, number>());
	const visibleAnchorIndexRef = useRef(0);
	const pendingScrollAdjustmentRef = useRef(0);
	const pendingJumpRef = useRef<number | null>(null);
	const pendingFocusIndexRef = useRef<number | null>(null);
	const [measuredHeights, setMeasuredHeights] = useState(measuredHeightsRef.current);
	const [jumpVersion, setJumpVersion] = useState(0);
	const [range, setRange] = useState<VirtualRange>(() => {
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
	const prefixHeights = useMemo(() => {
		const result = [0];
		for (const entry of entries) {
			const height = measuredHeights.get(entry.key) ?? ESTIMATED_TURN_HEIGHT_PIXELS;
			result.push(result.at(-1)! + height);
		}
		return result;
	}, [entries, measuredHeights]);

	const updateVisibleRange = useCallback(() => {
		const list = listRef.current;
		const scroller = scrollerRef.current;
		if (!list || !scroller || entries.length === 0) return;
		const viewport = scrollerViewport(scroller);
		const listTop = list.getBoundingClientRect().top;
		const viewportStart = Math.max(0, viewport.top - listTop);
		const viewportEnd = Math.max(viewportStart, viewport.top + viewport.height - listTop);
		visibleAnchorIndexRef.current = entryIndexAtOffset(prefixHeights, viewportStart);
		const nextRange = rangeForViewport(prefixHeights, viewportStart, viewportEnd);
		setRange((current) =>
			current.startIndex === nextRange.startIndex && current.endIndex === nextRange.endIndex
				? current
				: nextRange,
		);
	}, [entries.length, prefixHeights]);

	useLayoutEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const scroller = findScrollContainer(list);
		scrollerRef.current = scroller;
		updateVisibleRange();
		scroller.addEventListener("scroll", updateVisibleRange, {passive: true});
		window.addEventListener("resize", updateVisibleRange, {passive: true});
		return () => {
			scroller.removeEventListener("scroll", updateVisibleRange);
			window.removeEventListener("resize", updateVisibleRange);
			scrollerRef.current = null;
		};
	}, [updateVisibleRange]);

	useLayoutEffect(() => {
		const list = listRef.current;
		if (!list || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((observations) => {
			let changed = false;
			for (const observation of observations) {
				const element = observation.target as HTMLElement;
				const index = Number(element.dataset["transcriptEntryIndex"]);
				const entry = entries[index];
				if (!entry) continue;
				const height = observation.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height;
				const previousHeight = measuredHeightsRef.current.get(entry.key) ?? ESTIMATED_TURN_HEIGHT_PIXELS;
				if (Math.abs(previousHeight - height) < 0.5) continue;
				measuredHeightsRef.current.set(entry.key, height);
				if (index < visibleAnchorIndexRef.current) {
					pendingScrollAdjustmentRef.current += height - previousHeight;
				}
				changed = true;
			}
			if (changed) setMeasuredHeights(new Map(measuredHeightsRef.current));
		});
		for (const element of list.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")) {
			observer.observe(element);
		}
		return () => observer.disconnect();
	}, [entries, range.startIndex, range.endIndex]);

	useLayoutEffect(() => {
		const scroller = scrollerRef.current;
		const adjustment = pendingScrollAdjustmentRef.current;
		pendingScrollAdjustmentRef.current = 0;
		if (scroller && adjustment !== 0) scroller.scrollTop += adjustment;
		updateVisibleRange();
	}, [measuredHeights, updateVisibleRange]);

	useEffect(() => {
		function requestJump(event: Event) {
			const recordIndex = (event as TranscriptJumpRequestEvent).detail;
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
		return () => window.removeEventListener(TRANSCRIPT_JUMP_REQUEST_EVENT, requestJump);
	}, [entries]);

	useLayoutEffect(() => {
		const recordIndex = pendingJumpRef.current;
		const list = listRef.current;
		const scroller = scrollerRef.current;
		if (recordIndex === null || !list || !scroller) return;
		const entryIndex = entries.findIndex(
			(entry) => entry.startRecordIndex <= recordIndex && entry.endRecordIndex >= recordIndex,
		);
		if (entryIndex < range.startIndex || entryIndex >= range.endIndex) return;
		const viewport = scrollerViewport(scroller);
		const listOffset = list.getBoundingClientRect().top - viewport.top + scroller.scrollTop;
		scroller.scrollTop = Math.max(0, listOffset + prefixHeights[entryIndex]! - viewport.height / 2);
		const frame = requestAnimationFrame(() => {
			pendingJumpRef.current = null;
			jumpToMessage(recordIndex);
			updateVisibleRange();
		});
		return () => cancelAnimationFrame(frame);
	}, [entries, jumpVersion, prefixHeights, range.endIndex, range.startIndex, updateVisibleRange]);

	const promptIndices = useMemo(() => entries.flatMap((entry, index) => (entry.isPrompt ? [index] : [])), [entries]);
	usePromptJump({
		promptIndices,
		entryOffset: (index) => prefixHeights[index]!,
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
			scroller.scrollTop = Math.max(0, listOffset + prefixHeights[index]! - stickyHeaderInset(scroller));
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
		<div ref={listRef} data-testid="virtualized-transcript">
			<div className="sr-only">Use the up and down arrow keys to move between messages</div>
			<div aria-hidden="true" data-transcript-spacer="before" style={{height: prefixHeights[startIndex]}} />
			{entries.slice(startIndex, endIndex).map((entry, offset) => {
				const index = startIndex + offset;
				const isLast = index === entries.length - 1;
				return (
					<div
						key={entry.key}
						role="article"
						aria-label={`Message ${index + 1}`}
						aria-posinset={index + 1}
						aria-setsize={entries.length}
						tabIndex={isLast ? 0 : -1}
						onKeyDown={(event) => focusNeighbour(event, index)}
						data-transcript-entry-index={index}
						data-testid="transcript-row"
						data-perf-row={entry.kind}
						data-perf-line={entry.startRecordIndex}
						data-perf-last={isLast ? "" : undefined}
					>
						{entry.element}
					</div>
				);
			})}
			<div
				aria-hidden="true"
				data-transcript-spacer="after"
				style={{height: totalHeight - prefixHeights[endIndex]!}}
			/>
		</div>
	);
}

function SessionLineList({
	lines,
	shouldScrollToEnd,
	...renderProps
}: LineRenderProps & {
	lines: SessionLine[];
	shouldScrollToEnd: boolean;
}) {
	const verbose = useContext(TranscriptModeContext) === "verbose";
	const entries = buildSessionListEntries(lines, renderProps, verbose);
	const [expansionStore] = useState(() => new Map<string, ExpansionToggle>());
	return (
		<ExpansionStoreContext.Provider value={expansionStore}>
			<VirtualizedSessionEntries entries={entries} shouldScrollToEnd={shouldScrollToEnd} />
		</ExpansionStoreContext.Provider>
	);
}

const HOOK_WARNING_SUBTYPES = new Set(["hook_non_blocking_error", "hook_additional_context"]);
const HOOK_ERROR_SUBTYPES = new Set(["hook_cancelled", "hook_blocking_error"]);
/**
 * Diagnostic rows upstream claude.ai/code never draws in Normal: the agent and
 * skill listings, batching reminders and queued commands. Verbose keeps them.
 */
const VERBOSE_ONLY_SUBTYPES = new Set([
	"agent_listing_delta",
	"skill_listing",
	"batching_reminder_sent",
	"total_tokens_reminder",
	"queued_command",
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
]);

interface AttachmentHead {
	type: string | null;
	hookEvent: string | null;
	prompt: string | null;
}

function getAttachmentHead(json: string): AttachmentHead {
	try {
		const parsed = JSON.parse(json) as {type?: unknown; hookEvent?: unknown; prompt?: unknown};
		return {
			type: typeof parsed.type === "string" ? parsed.type : null,
			hookEvent: typeof parsed.hookEvent === "string" ? parsed.hookEvent : null,
			prompt: typeof parsed.prompt === "string" ? parsed.prompt : null,
		};
	} catch {
		return {type: null, hookEvent: null, prompt: null};
	}
}

/** Diagnostic attachments shown only in Verbose; subagent hand-backs stay as "Message from" rows. */
function isVerboseOnlyAttachment({type, hookEvent, prompt}: AttachmentHead): boolean {
	if (type === "queued_command") return prompt === null || parseAgentMessage(prompt) === null;
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

	const hasText = content.some((b) => b.type === "text" && typeof b.text === "string" && b.text.trim() !== "");
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
			else if (/<local-command-caveat>/.test(block.text)) {
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

	if (kind in LABEL_BY_KIND) {
		const label = LABEL_BY_KIND[kind as LabeledKind];
		return (
			<LabeledAutomatedEntry
				line={line}
				sessionId={sessionId}
				label={label}
				allowedImageRoots={allowedImageRoots}
			/>
		);
	}

	const {textNodes, mediaNodes} = renderUserContentBlocks(line, sessionId, allowedImageRoots);

	return (
		<UserTurn text={messageText(line)}>
			<TranscriptMessageMenu
				speaker="user"
				sessionId={sessionId}
				uuid={line.uuid}
				markdown={messageText(line)}
				render={<div className="flex flex-col items-end gap-g6 max-w-[85%] min-w-0" />}
			>
				{textNodes.length > 0 && (
					<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-r7 bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body select-text">
						{textNodes}
					</div>
				)}
				{mediaNodes}
				<UserTurnActions line={line} sessionId={sessionId} />
			</TranscriptMessageMenu>
		</UserTurn>
	);
}

type LabeledKind = "request-interrupted" | "compact-summary" | "stop-hook";

const LABEL_BY_KIND: Record<LabeledKind, string> = {
	"request-interrupted": "Request interrupted",
	"compact-summary": "Compact summary",
	"stop-hook": "Stop hook feedback",
};

/**
 * Upstream's "Compacted conversation" marker row, keeping the local
 * compact-summary text behind it as the expandable body.
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

	return (
		<UserTurn text="Compacted conversation">
			<div className="flex flex-col w-full min-w-0">
				<MarkerDisclosureButton
					label="Compacted conversation"
					expanded={expanded}
					bodyId={bodyId}
					onToggle={() => setExpanded(!expanded)}
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
	const {textNodes, mediaNodes} = renderUserContentBlocks(line, sessionId, allowedImageRoots);

	return (
		<div id={id} className="flex justify-end pt-p6">
			<div className="flex flex-col items-end gap-g6 max-w-[85%] min-w-0">
				{textNodes.length > 0 && (
					<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-r7 bg-auto-msg-bg text-auto-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body select-text">
						{textNodes}
					</div>
				)}
				{mediaNodes}
				<UserTurnActions line={line} sessionId={sessionId} />
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
	const {textNodes, mediaNodes} = renderUserContentBlocks(line, sessionId, allowedImageRoots);

	if (textNodes.length === 0 && mediaNodes.length === 0) return null;

	return (
		<UserTurn text={messageText(line)}>
			<div className="flex flex-col items-end gap-g6 max-w-[85%] min-w-0">
				<div className="flex items-center gap-1.5 px-1">
					<span className="text-[10px] font-medium text-t6 bg-surface-0 rounded-full px-2 py-0.5">
						{label}
					</span>
				</div>
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
				if (/<local-command-caveat>/.test(block.text)) continue;
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
}

/** A prompt's text; the first block of a prompt opens with a slash-command chip when it starts with `/name`. */
function UserPromptText({text, leading}: {text: string; leading: boolean}) {
	const command = leading ? splitLeadingSlashCommand(text) : null;
	if (command === null) return <UserPlainText text={text} />;
	return <SlashCommandText name={command.name} rest={command.rest} />;
}

function renderUserContentBlocks(
	line: MessageSessionLine,
	sessionId: string,
	allowedImageRoots: readonly string[],
): UserContentBlocks {
	const content = line.message?.content;
	if (!content) return {textNodes: [], mediaNodes: []};

	if (typeof content === "string") {
		const cleaned = stripCommandTags(content);
		if (!cleaned) return {textNodes: [], mediaNodes: []};
		return {
			textNodes: [
				<React.Fragment key={0}>
					<TruncatedContent>
						<UserPromptText text={cleaned} leading={true} />
					</TruncatedContent>
					<DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
				</React.Fragment>,
			],
			mediaNodes: [<InlinePathImages key="path-images" text={cleaned} allowedRoots={allowedImageRoots} />],
		};
	}

	const textNodes: React.ReactNode[] = [];
	const mediaNodes: React.ReactNode[] = [];
	const inlineImageText: string[] = [];
	for (let i = 0; i < content.length; i++) {
		const block = content[i]!;
		if (block.type === "text" && typeof block.text === "string") {
			if (/<local-command-caveat>/.test(block.text)) continue;
			const cleaned = stripCommandTags(block.text);
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
		} else if (block.type === "image" && block.source) {
			mediaNodes.push(
				<div key={`img-${i}`} className="relative inline-block">
					<img
						src={`data:${block.source.media_type};base64,${block.source.data}`}
						alt="Session image"
						className={SESSION_IMAGE_CLASS_NAME}
					/>
					<DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
				</div>,
			);
		} else if (block.type === "document" && block.source) {
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
	if (inlineImageText.length > 0) {
		mediaNodes.push(
			<InlinePathImages key="path-images" text={inlineImageText.join("\n")} allowedRoots={allowedImageRoots} />,
		);
	}
	return {textNodes, mediaNodes};
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
			<div className="flex flex-col items-end gap-g6 max-w-[85%] min-w-0">
				<div className="user-message-bubble relative flex flex-col gap-[5px] rounded-r7 bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body select-text">
					<TruncatedContent>
						<SlashCommandText name={name} rest={cmdArgs ?? ""} />
					</TruncatedContent>
					<DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
				</div>
				<UserTurnActions line={line} sessionId={sessionId} />
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
			(b.type === "text" && typeof b.text === "string" && b.text.trim() !== "") ||
			(b.type === "thinking" && showThinking && typeof b.thinking === "string" && b.thinking.trim() !== "") ||
			b.type === "image" ||
			b.type === "document",
	);
	const hasToolUse = toolCalls.length > 0;

	// No visible content at all -- hide the entry entirely
	if (!hasVisibleNonToolContent && !hasToolUse) {
		return null;
	}

	const attributionRow = <AttributionRow line={line} />;

	// Only tool_use blocks -- render as a tool call section
	if (!hasVisibleNonToolContent && hasToolUse) {
		if (!showTools) return null;
		return (
			<>
				{attributionRow}
				<ToolCallSection calls={toolCalls} sessionId={sessionId} />
			</>
		);
	}

	// Mixed content: render each block in original order
	return (
		<div className="flex flex-col gap-[var(--chat-item-gap)] min-w-0 select-text">
			{attributionRow}
			{line.isApiErrorMessage === true && <ApiErrorCallout line={line} />}
			{content.map((block, i) => (
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
		</div>
	);
}

/**
 * Pills attributing an assistant turn to the skill or MCP server that drove
 * it. The transcript layer dedupes consecutive identical attribution, so this
 * renders once per skill/MCP block.
 */
function AttributionRow({line}: {line: MessageSessionLine}) {
	const skillLabel = line.attributionSkill ?? line.attributionPlugin;
	const mcpLabel = line.attributionMcpServer
		? `${line.attributionMcpServer}${line.attributionMcpTool ? ` · ${line.attributionMcpTool}` : ""}`
		: undefined;
	if (!skillLabel && !mcpLabel) return null;
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

/** Error callout for assistant turns flagged as API error messages. */
function ApiErrorCallout({line}: {line: MessageSessionLine}) {
	const details = line.errorDetails;
	const detailsText =
		details === undefined ? undefined : typeof details === "string" ? details : JSON.stringify(details, null, 2);
	return (
		<div className="border-l-2 border-danger-000 bg-danger-000/10 rounded-r px-3 py-2">
			<div className="flex items-center gap-1.5 text-xs text-danger-000">
				<AlertTriangle className="h-3.5 w-3.5" />
				API Error{line.apiErrorStatus !== undefined ? ` ${line.apiErrorStatus}` : ""}
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
	if (block.type === "text" && typeof block.text === "string") {
		if (!block.text.trim()) return null;
		return (
			<div className="relative min-w-0 text-body text-primary" data-transcript-prose>
				<ProseMarkdown markdown={block.text} />
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
		const firstToolUseIndex = ((line.message?.content ?? []) as SessionContentBlock[]).findIndex(
			(b) => b.type === "tool_use",
		);
		if (blockIndex !== firstToolUseIndex) return null;
		return <ToolCallSection calls={toolCalls} sessionId={sessionId} />;
	}

	if (block.type === "image" && block.source) {
		return (
			<div className="relative inline-block">
				<img
					src={`data:${block.source.media_type};base64,${block.source.data}`}
					alt="Session image"
					className="max-w-full max-h-96 rounded-lg border border-border shadow-sm"
				/>
				<DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
			</div>
		);
	}

	if (block.type === "document" && block.source) {
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
 * Tools drawn in full rather than collapsed into a summary row. Their renderer
 * owns the card shell -- upstream draws a card once per body, so the wrapper
 * here stays a bare positioning context for the DebugLink.
 */
const PROMINENT_TOOLS = new Set(["AskUserQuestion"]);
const TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskStop"]);

function ToolCallSection({
	calls,
	sessionId,
	notices = NO_NOTICES,
}: {
	calls: ClientToolCall[];
	sessionId: string;
	notices?: readonly BackgroundNotice[];
}) {
	const prominentCalls = calls.filter((c) => PROMINENT_TOOLS.has(c.name));
	const backgroundCalls = calls.filter((c) => !PROMINENT_TOOLS.has(c.name));

	return (
		<>
			{backgroundCalls.length === 1 && notices.length === 0 && (
				<ToolCallRow call={backgroundCalls[0]!} sessionId={sessionId} />
			)}
			{(backgroundCalls.length > 1 || notices.length > 0) && (
				<ToolCallSummary calls={backgroundCalls} sessionId={sessionId} notices={notices} />
			)}
			{prominentCalls.map((call, i) => {
				const Renderer = getToolRenderer(call.name);
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
const NON_EXPANDING_TOOLS = new Set(["TodoWrite", "EnterPlanMode"]);

/**
 * Tools whose renderer body is nothing but the call's result plus the input
 * keys listed here. With no result and none of those keys, the renderer draws
 * an empty card, so the row has nothing to disclose -- upstream renders such a
 * row bare, with no chevron and no expander.
 */
const RESULT_ONLY_BODY_INPUT_KEYS: Record<string, readonly string[]> = {
	TaskList: [],
	TaskGet: ["taskId", "id"],
};

function rendersEmptyBody(call: ClientToolCall): boolean {
	const inputKeys = RESULT_ONLY_BODY_INPUT_KEYS[call.name];
	if (inputKeys === undefined) return false;
	if (call.result) return false;
	return !inputKeys.some((key) => call.input[key] !== undefined);
}

/**
 * Tools that show inline diff stats (+N -M) in the clickable row.
 */
const EDIT_TOOLS = new Set(["Edit", "MultiEdit"]);

/**
 * Compute diff stats from an Edit tool call's old_string / new_string input.
 */
function useEditDiffStats(call: ClientToolCall): {added: number; removed: number} | null {
	return useMemo(() => {
		if (!EDIT_TOOLS.has(call.name)) return null;
		const entries = editDiffEntries(call.input);
		if (entries.length === 0) return null;
		let added = 0;
		let removed = 0;
		for (const entry of entries) {
			const data = computeDiffData(entry.oldStr, entry.newStr);
			added += data.added;
			removed += data.removed;
		}
		return {added, removed};
	}, [call.name, call.input]);
}

/** A call whose tool_result has not arrived yet. */
function isPendingToolCall(call: ClientToolCall): boolean {
	return call.resultUuid === undefined && call.result === undefined && call.isError !== true;
}

/** Upstream draws an in-flight tool label in primary ink with a shimmer sweep. */
const RUNNING_LABEL_CLASS = "text-primary tool-shimmer";

function ToolCallRow({call, sessionId, nested = false}: {call: ClientToolCall; sessionId: string; nested?: boolean}) {
	const [expanded, toggleExpanded] = useModeExpansion(`row:${call.id}`);
	const bodyId = useId();
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
	const Renderer = getToolRenderer(call.name);
	const pending = isPendingToolCall(call);
	const toolRowLabel = toolLabel(call);
	const running = pending ? runningToolLabel(call) : null;
	const isFileParam = FILE_PARAM_TOOLS.has(call.name);
	const diffStats = useEditDiffStats(call);
	const isCardStyle = CARD_STYLE_TOOLS.has(call.name) && !nested;
	const isCodeCard = CODE_CARD_TOOLS.has(call.name);
	// Renderers that draw nothing leave no padded gap.
	const bodyClass =
		(nested && ROW_BODY_TOOLS.has(call.name)
			? "group/body relative flex w-full pt-p3"
			: "group/body relative flex w-full flex-col pt-p3") + " empty:hidden";
	// Collapsed rows recede to muted ink and lift to secondary on hover; an open
	// row stays secondary, as upstream does.
	const ink = expanded ? "text-secondary" : "text-ink-muted group-hover/tool:text-secondary";
	// Upstream recolors the whole label of a failed tool row, except a file path,
	// which stays primary.
	// A settled Skill row reads "Ran skill" in secondary ink beside a primary
	// skill name, as upstream draws it.
	const isSkill = call.name === "Skill" && !call.isError && !pending;
	const labelClass = call.isError
		? "text-danger-ink"
		: pending
			? RUNNING_LABEL_CLASS
			: isSkill
				? "text-secondary"
				: ink;
	const isCompletedPaneAgent = paneAgentId !== undefined && !call.isError && !pending;
	const paramClass = isSkill || isCompletedPaneAgent ? "text-primary" : labelClass;
	// A subagent row's chevron sits in the flat `t6` token upstream gives it,
	// rather than the hover-reactive ink every other tool row uses.
	const chevronClass = isAgent ? "shrink-0 self-center text-t6" : `shrink-0 ${ink}`;
	// A failed call whose param is its own description reads as one phrase
	// ("Failed to install dependencies and build"), so upstream drops the verb
	// and the separate param span; every other failed row keeps both
	// ("Failed to edit" + "cache.ts").
	const failedDescription = call.isError ? getToolDescription(call.name, call.input) : null;
	const phrase =
		failedDescription !== null
			? failedDescriptionLabel(failedDescription)
			: call.isError || (isAgent && (nested || !pending))
				? null
				: running !== null
					? (running.label ?? null)
					: (toolRowLabel.doneLabel ?? null);
	const label = phrase ?? (call.isError ? toolRowLabel.failedVerb : (running?.verb ?? toolRowLabel.verb));
	// A label that is a whole phrase owns the row and truncates; a bare verb
	// keeps its width so the param beside it truncates instead.
	const isPhraseLabel = phrase !== null;

	const displayParam =
		RENDERER_HANDLES_PARAM.has(call.name) || isPhraseLabel
			? ""
			: isFileParam
				? (call.param.split("/").pop() ?? call.param)
				: (toolRowLabel.meta ?? call.param);
	const paramHref = displayParam === toolRowLabel.meta ? toolRowLabel.metaHref : undefined;
	const paramIsCode = displayParam === toolRowLabel.meta && toolRowLabel.metaIsCode === true;
	const rangeLabel = displayParam ? readRangeLabel(call) : null;

	const rowLabel = (
		<>
			{label && (
				<span className={`${isPhraseLabel ? "truncate min-w-0" : "shrink-0"} text-body ${labelClass}`}>
					{label}
				</span>
			)}
			{displayParam && (
				<span
					className={
						isFileParam
							? "text-body text-primary truncate min-w-0"
							: `truncate min-w-0 text-body ${paramClass}`
					}
				>
					{paramHref ? (
						<a
							href={paramHref}
							target="_blank"
							rel="noreferrer"
							onClick={(e) => e.stopPropagation()}
							className="hover:underline"
						>
							{displayParam}
						</a>
					) : paramIsCode ? (
						<code className="font-mono">{displayParam}</code>
					) : (
						displayParam
					)}
				</span>
			)}
			{rangeLabel && <span className={`text-body ${labelClass} truncate min-w-0`}>{rangeLabel}</span>}
			{diffStats && <DiffStats added={diffStats.added} removed={diffStats.removed} />}
		</>
	);

	const body = !hasBody ? null : isCardStyle ? (
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
	);

	if (paneAgentId !== undefined && openSubagent !== null) {
		const open = () => openSubagent(paneAgentId);
		return (
			<div data-tool-row="" className="flex flex-col w-full">
				<div
					role="button"
					tabIndex={0}
					data-transcript-keeps-pin=""
					onClick={open}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							open();
						}
					}}
					className="relative group/tool flex self-start max-w-full items-center py-0 gap-g2 text-left cursor-pointer outline-none hide-focus-ring focus:ring-focus rounded-r3"
				>
					{rowLabel}
				</div>
			</div>
		);
	}

	if (!expandable) {
		return (
			<div data-tool-row="" className="flex flex-col w-full">
				<div className="relative group/tool flex self-start max-w-full items-center py-0 gap-g2 text-left">
					{rowLabel}
				</div>
				{body}
			</div>
		);
	}

	return (
		<div data-tool-row="" className="flex flex-col w-full">
			<div
				role="button"
				tabIndex={0}
				aria-expanded={expanded}
				aria-controls={bodyId}
				onClick={toggleExpanded}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						toggleExpanded();
					}
				}}
				className="relative group/tool flex self-start max-w-full items-center py-0 gap-g2 text-left cursor-pointer outline-none hide-focus-ring focus:ring-focus rounded-r3"
			>
				{rowLabel}
				<span className={chevronClass}>
					<ChevronIcon expanded={expanded} size={14} />
				</span>
			</div>
			{expanded && (
				<div id={bodyId} className="flow-root">
					{body}
				</div>
			)}
		</div>
	);
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
}: {
	calls: ClientToolCall[];
	sessionId: string;
	notices?: readonly BackgroundNotice[];
}) {
	const [expanded, toggleExpanded] = useModeExpansion(`group:${calls[0]?.id ?? `notice-${notices[0]?.lineIndex}`}`);
	const bodyId = useId();
	const taskCalls = calls.filter((c) => TASK_TOOLS.has(c.name));
	const hasTasksView = taskCalls.length >= 3;
	const displayCalls = hasTasksView ? calls.filter((c) => !TASK_TOOLS.has(c.name)) : calls;
	const summary = useMemo(
		() =>
			summarizeToolCallStats(
				displayCalls,
				notices.map((notice) => notice.notification),
			),
		[displayCalls, notices],
	);
	// While a call is in flight, upstream names the group by that call's
	// progressive label instead of the tally.
	const pendingCall = displayCalls.filter(isPendingToolCall).at(-1);
	const runningText = pendingCall === undefined ? null : runningToolLabelText(runningToolLabel(pendingCall));
	// Collapsed rows recede to muted ink and lift to secondary on hover; an open
	// row stays secondary, as upstream does.
	const ink = expanded ? "text-secondary" : "text-ink-muted group-hover/tool:text-secondary";

	return (
		<div data-tool-row="" className="flex flex-col w-full">
			{hasTasksView && (
				<div className="mb-2">
					<TasksView toolCalls={calls} />
				</div>
			)}
			{(displayCalls.length > 0 || notices.length > 0) && (
				<>
					<button
						type="button"
						aria-expanded={expanded}
						aria-controls={bodyId}
						onClick={toggleExpanded}
						className="relative group/tool flex self-start max-w-full items-center py-0 gap-g1 text-left cursor-pointer outline-none hide-focus-ring focus:ring-focus rounded-r3"
					>
						<span className={`inline-flex items-center gap-g3 min-w-0 ${ink}`}>
							{runningText === null ? (
								<span className="text-body truncate min-w-0">
									<SummarySpans segments={summary.segments} />
								</span>
							) : (
								<span className={`text-body truncate min-w-0 ${RUNNING_LABEL_CLASS}`}>
									{runningText}
								</span>
							)}
						</span>
						{hasDiffStats(summary) && (
							<span className="flex gap-g1 tabular-nums shrink-0">
								<span className="text-diff-added">+{summary.added}</span>
								<span className="text-diff-removed">-{summary.removed}</span>
							</span>
						)}
						<span className={`shrink-0 ${ink}`}>
							<ChevronIcon expanded={expanded} size={14} />
						</span>
					</button>
					{expanded && (
						<div id={bodyId} className="flow-root">
							{/* Upstream separates the grouped rows with hairline dividers and
                  per-child padding inside one outlined card, not with gaps
                  between rows floating on a tinted panel. */}
							<div className="flex flex-col card-outline rounded-r6 overflow-clip mt-p6 divide-y [&>*]:px-p7 [&>*]:py-p6">
								{displayCalls.map((call, i) => (
									<ToolCallRow key={i} call={call} sessionId={sessionId} nested />
								))}
								{notices.map((notice) => (
									<BackgroundNoticeRow key={`notice-${notice.lineIndex}`} notice={notice} />
								))}
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
