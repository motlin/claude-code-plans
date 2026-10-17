import {SessionSkeleton} from "./session-skeleton";
import {sessionScrollKey} from "../lib/session-route-location";
import {useLocation} from "@tanstack/react-router";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps} from "react";
import {Minimize2} from "lucide-react";
import {SessionTileFrame, type SessionTileScrollPosition} from "./session-tile-frame";
import {SessionRailSlot} from "./session-rail/session-rail-slot";
import {useSessionRailDocked} from "./session-rail/use-session-rail-docked";
import type {SessionRailInputs} from "./session-rail/session-rail-cards";
import {SessionChat} from "./session-chat";
import {ChapterChips} from "./chapter-chips";
import {TranscriptActionsProvider} from "./transcript-actions-provider";
import {useSessionFork} from "../hooks/use-session-fork";
import {Composer} from "./composer";
import {StreamingMessage} from "./streaming-message";
import {SessionHookContext} from "./session-hook-context";
import {useSettings} from "./settings-context";
import {useTranscriptModeShortcut} from "../hooks/use-session-transcript-mode";
import {sessionHasThinking} from "../lib/transcript-mode";
import {SessionTitlebar} from "./session-titlebar";
import {SessionAiTitleLine} from "./session-ai-title-line";
import {SESSION_STICKY_HEADER_CLASS} from "./titlebar-classes";
import {syncUnseenFromSummaries} from "../lib/unread-store";
import {
	AskUserQuestionProvider,
	type AnswerSubmission,
	type AskUserQuestionContextValue,
} from "./ask-user-question-context";
import {SessionFileRefs} from "./file-refs";
import type {JumpTargetWindow} from "./jump-target-context";
import {LegacyMessageLinkNotice} from "./legacy-message-link-notice";
import {TileHost} from "./panes/tile-host";
import {useRegisterArtifactsPane, useSessionArtifacts} from "./panes/artifacts-pane-entry";
import {useRegisterBackgroundTasksPane} from "./panes/background-tasks-pane-entry";
import {preloadLinksPane, useRegisterLinksPane} from "./panes/links-pane-entry";
import {useRegisterSessionDetailsPane} from "./panes/session-details-pane-entry";
import {useRegisterSubagentPane} from "./panes/subagent-pane-entry";
import {SessionBackgroundTasksOpener, SessionSubagentOpener} from "./subagent-opener";
import {hasSessionPlan, useRegisterPlanPane} from "./panes/plan-pane-entry";
import {sessionPlanModel} from "../lib/session-plan-model";
import {useRegisterChangesPane} from "./changes/changes-pane-entry";
import {ChangesPaneShortcut} from "./changes/changes-pane-shortcut";
import {preloadFilesPane, useRegisterFilesPane} from "./panes/files-pane-entry";
import {FilesPaneShortcut} from "./panes/files-pane-shortcut";
import {useExtractedSessionFiles} from "./panes/session-file-sources";
import {TerminalPaneShortcut} from "./panes/terminal-pane";
import {useRegisterTerminalPane} from "./panes/terminal-pane-entry";
import {PermissionCard} from "./permission-card";
import {BranchStrip} from "./branch-strip";
import {TranscriptHistoryLoader, TranscriptTopFade} from "./transcript-history-loader";
import {Tooltip} from "./ui/tooltip";
import {SessionPaneControls} from "./view-options-menu";
import {SessionDock} from "./session-dock";
import {RunningTasksControl} from "./running-tasks-control";
import {sessionProcessLive} from "../lib/session-state";
import {tailMarkerState} from "../lib/working-marker";
import {WaitingForInputNotice} from "./approval-card";
import {QuestionCard} from "./question-card";
import {showsWaitingForInputNotice} from "./waiting-for-input-notice";
import {NotifyMePrompt} from "./notify-me-prompt";
import {UsagePaceBanner} from "./usage-pace-banner";
import {WorkingMarker} from "./working-marker";
import {useWorkingMarkerState} from "./use-working-marker-state";
import {SideChat} from "./side-chat";
import {handleBtwPrompt} from "./btw-prompt";
import {useSideChatShortcut} from "./use-side-chat-shortcut";
import {useToast} from "./toast-context";
import {CHAT_COLUMN_CLASS, transcriptWidthStyle} from "../lib/transcript-width";
import {useChatStream} from "../hooks/use-chat-stream";
import {slashCommandsQueryOptions} from "../lib/api/commands";
import {promptHistoryQueryOptions} from "../lib/api/prompt-history";
import {useShortcutKeys} from "../hooks/use-shortcut";
import {useLiveLaunchOptions} from "../hooks/use-live-launch-options";
import {canStopResponse, useStopResponse} from "../hooks/use-stop-response";
import {useComposerQueue} from "../hooks/use-composer-queue";
import {
	type ComposerPaneState,
	type ComposerSubmit,
	dispatchComposerSubmit,
	forkSubmitLabel,
	launchPromptFork,
} from "../lib/composer-fork-routing";
import {composerPendingGate, composerSendPlan, gateHoldsQueue} from "../lib/composer-pending-gate";
import {assertNever} from "../lib/assert-never";
import {canApplyLive, type LaunchOptions, modeMenuItems} from "../lib/launch-options";
import {setPendingFork} from "../lib/session-fork";
import {
	useClaudeEvents,
	useComposerServerState,
	useIsSessionActive,
	cachedSessionSummary,
	useCachedSessionSummary,
	useStatusline,
} from "../hooks/use-claude-events";
import {
	lastAssistantEffortFromRecords,
	lastAssistantModelFromRecords,
	lastAssistantUsageFromRecords,
	lastPermissionModeFromRecords,
	resolveComposerState,
} from "../lib/composer-state";
import {useSessionViewedState} from "../hooks/use-session-viewed-state";
import {usePendingMessageJump} from "../hooks/use-pending-message-jump";
import {useMainScrollRestoration, type MainScrollRestorationSnapshot} from "../hooks/use-main-scroll-restoration";
import {findLastPendingToolUse, findPendingAskUserQuestion} from "../lib/approval-dock";
import {applicationSettingsQueryOptions} from "../lib/api/application-settings";
import {
	herdrPanesQueryOptions,
	launchHerdrSession,
	sendHerdrInterrupt,
	sendHerdrPermissionDecision,
	sendHerdrQuestionAnswer,
} from "../lib/api/herdr";
import {notificationsQueryOptions} from "../lib/api/notifications";
import {pendingQuestionQueryOptions} from "../lib/api/pending-question";
import {findPendingPermission, permissionWaitToolUseId, type PermissionDecision} from "../lib/permission-card";
import type {HerdrPaneIndexData} from "../lib/api/herdr";
import type {PaneKind} from "../lib/pane-layout";
import type {QuestionAnswer} from "../lib/hook-events";
import {
	sessionDetailQueryOptions,
	sessionResourcesQueryOptions,
	sessionSubagentsQueryOptions,
	transcriptEndIndex,
	transcriptQueryOptions,
	useRequestSummary,
} from "../lib/api/sessions";
import type {SessionDetailData, SessionSubagentsData, TranscriptData} from "../lib/api/sessions";
import {countMessageRecords} from "../lib/message-count";
import {getSubagentLifecycleKey, extractPendingSubagents, type ActiveSubagent} from "../lib/subagents";
import {processTranscript} from "../lib/transcript";
import {backgroundTasksFacts, extractBackgroundTasks} from "../lib/background-tasks";
import {createSessionCommands} from "../lib/session-commands";
import {useIdlePrefetch} from "../hooks/use-idle-prefetch";
import {getSessionPromptBehavior} from "./session-prompt-behavior";
import {sessionAnswerRoute} from "../hooks/use-question-answer-route";
import {useLiveHerdrPrompt} from "./use-live-herdr-prompt";

/** The Files and Links renderers, warmed once the session page goes idle so their first show skips the loading row. */
const SESSION_PANE_CHUNKS = [preloadFilesPane, preloadLinksPane];

function SessionChrome({children}: {children: React.ReactNode}) {
	return <div className="h-full overflow-auto">{children}</div>;
}

function SessionNotFound() {
	return (
		<SessionChrome>
			<h1 className="flex h-8 items-center text-body font-medium">Session Not Found</h1>
			<p className="mt-2 text-t6">This session could not be found.</p>
		</SessionChrome>
	);
}

/** A pane to open on arrival (the `?pane=` deep link), reported back once handled. */
interface RequestedPaneProps {
	requestedPane?: PaneKind | undefined;
	onRequestedPaneHandled?: (() => void) | undefined;
}

// The usage breakdown card only loads once "See detailed breakdown" is clicked.
const SessionUsageCard = lazy(async () =>
	import("./session-usage-card").then((module) => ({default: module.SessionUsageCard})),
);

// The session rail's cards load on its first show.
const SessionRailCards = lazy(async () =>
	import("./session-rail/session-rail-cards").then((module) => ({default: module.SessionRailCards})),
);

/** The chat tile with the session rail docked at its end while shown and no side pane is open. */
function RailTileFrame({
	railInputs,
	...props
}: Omit<ComponentProps<typeof SessionTileFrame>, "rail" | "railDocked"> & {railInputs: SessionRailInputs}) {
	const railDocked = useSessionRailDocked();
	return (
		<SessionTileFrame
			{...props}
			railDocked={railDocked}
			rail={<SessionRailSlot render={() => <SessionRailCards inputs={railInputs} />} />}
		/>
	);
}

// The notify tip shows nothing until the user comes back from 30s away, so it loads with the first permission card.
const ToolApprovalNotifyTip = lazy(async () =>
	import("./tool-approval-notify-tip").then((module) => ({default: module.ToolApprovalNotifyTip})),
);

export function SessionPage({
	sessionId,
	routeId = sessionId,
	scrollKey,
	scrollRestoration,
	requestedPane,
	onRequestedPaneHandled,
}: {
	sessionId: string;
	routeId?: string;
	scrollKey?: string;
	scrollRestoration?: MainScrollRestorationSnapshot | undefined;
} & RequestedPaneProps) {
	// Plain `useQuery` (not suspense) so the app shell stays painted and this
	// page can show its own skeleton while the transcript payload loads.
	const detailQuery = useQuery(sessionDetailQueryOptions(sessionId));
	const transcriptQuery = useQuery(transcriptQueryOptions(sessionId));
	const subagentsQuery = useQuery(sessionSubagentsQueryOptions(sessionId));
	const herdrQuery = useQuery(herdrPanesQueryOptions);
	const locationScrollKey = useLocation({
		select: (location) => sessionScrollKey(location, sessionId),
	});
	// The route boundary keeps the departing visit stable while the next location is still loading.
	const initialScrollKey = scrollKey ?? locationScrollKey;
	// Standalone callers capture before detail loads; routed pages supply the earlier pre-alias snapshot.
	const standaloneRestoredPosition = useMainScrollRestoration(initialScrollKey);
	// An explicitly captured undefined entry is authoritative: it is a fresh visit.
	const restoredScrollPosition =
		scrollRestoration === undefined ? standaloneRestoredPosition : scrollRestoration.entry;
	// The session list usually knows the title before the session itself loads; read once, as only the skeleton uses it.
	const queryClient = useQueryClient();

	if (detailQuery.isError) throw detailQuery.error;
	if (transcriptQuery.isError) throw transcriptQuery.error;
	if (subagentsQuery.isError) throw subagentsQuery.error;
	if (herdrQuery.isError) throw herdrQuery.error;

	const data = detailQuery.data;
	useSideChatShortcut(sessionId, data !== null && data !== undefined);
	if (data === null) return <SessionNotFound />;

	const transcript = transcriptQuery.data;
	const subagents = subagentsQuery.data;
	const herdr = herdrQuery.data;
	if (!data || !transcript || !subagents || !herdr)
		return (
			<SessionChrome>
				<SessionSkeleton title={cachedSessionSummary(queryClient, sessionId)?.title} />
			</SessionChrome>
		);

	return (
		<SessionView
			sessionId={sessionId}
			routeId={routeId}
			data={data}
			transcript={transcript}
			subagents={subagents}
			herdr={herdr}
			initialScrollKey={initialScrollKey}
			restoredScrollPosition={restoredScrollPosition}
			requestedPane={requestedPane}
			onRequestedPaneHandled={onRequestedPaneHandled}
		/>
	);
}

interface SessionViewProps extends RequestedPaneProps {
	sessionId: string;
	routeId: string;
	/** The location's history key: the transcript scrolls to its end once per key. */
	initialScrollKey: string;
	/** The `<main>` position the router restores for this location, if it has one of its own. */
	restoredScrollPosition: ReturnType<typeof useMainScrollRestoration>;
	data: SessionDetailData;
	transcript: TranscriptData;
	subagents: SessionSubagentsData;
	herdr: HerdrPaneIndexData;
}

function SessionView({
	sessionId,
	routeId,
	data,
	transcript,
	subagents,
	herdr,
	initialScrollKey,
	restoredScrollPosition,
	requestedPane,
	onRequestedPaneHandled,
}: SessionViewProps) {
	// The project path can fail to resolve from its lossy directory name (e.g. a
	// dotted folder), so the session's recorded cwd stands in for it.
	const sessionDirectory = data.projectPath ?? data.cwd;
	const scrollAnchorRef = useRef<HTMLDivElement>(null);
	const tileScrollPosition = useRef<SessionTileScrollPosition | null>(null);
	const locationHash = useLocation({select: (location) => location.hash});
	// Viewed positions are stored in message units (see message-count.ts) so
	// they line up with messageCount and newMessageCount on every surface. The
	// transcript is only a window over the JSONL, so the messages the server
	// trimmed off the front still count towards the position.
	const currentMessageIndex = useMemo(
		() => transcript.precedingMessageCount + countMessageRecords(transcript.records) - 1,
		[transcript.precedingMessageCount, transcript.records],
	);
	// Grows only when the session appends; paging backwards through history
	// leaves it alone, so it stays a reliable "did new work land?" signal.
	const endIndex = transcriptEndIndex(transcript);
	const {visibilityRef} = useSessionViewedState(sessionId, currentMessageIndex);
	const sessionViewRef = useCallback(
		(element: HTMLDivElement | null) => {
			scrollAnchorRef.current = element;
			visibilityRef(element);
		},
		[visibilityRef],
	);
	const detailUnseen = !data.viewedState.viewedAnywhere;
	useEffect(() => {
		syncUnseenFromSummaries([{id: sessionId, unseen: detailUnseen}]);
	}, [detailUnseen, sessionId]);
	const {settings, setSetting} = useSettings();
	// Keyed off the window's startIndex so every line carries its session-absolute
	// JSONL record index, which locates a row whose record was collapsed into a
	// neighbour and resolves links copied before anchors moved to message uuids.
	const processed = useMemo(
		() => processTranscript(transcript.records, transcript.startIndex),
		[transcript.records, transcript.startIndex],
	);
	const hasThinking = useMemo(() => sessionHasThinking(processed.lines), [processed.lines]);
	const transcriptView = useTranscriptModeShortcut(sessionId, {hasThinking});
	const {mode: transcriptMode, flags: transcriptFlags} = transcriptView;
	// `uuidToLine` is the set of messages the window holds, which is how a jump
	// decides whether to scroll or to page history in first.
	const requestMessageJump = usePendingMessageJump(sessionId, transcript.startIndex, processed.uuidToLine);
	useRegisterChangesPane(sessionId);
	// A whole-session inventory costs a full pass over the JSONL, so only an open
	// Files or Links pane asks for it; this read just shares whatever they fetched.
	const resources = useQuery(sessionResourcesQueryOptions(sessionId, false)).data;
	// Until that scan lands, the panes fall back to extraction over the loaded
	// window, whose counts are floors: every surface showing one also takes
	// `transcript.startIndex`, the records still on the server, and marks the
	// count `12+` rather than passing a partial tally off as the total.
	const windowFiles = useExtractedSessionFiles(processed.lines, data.homeRoot);
	const jumpTargetWindow = useMemo<JumpTargetWindow>(
		() => ({windowStartIndex: transcript.startIndex, requestMessageJump}),
		[requestMessageJump, transcript.startIndex],
	);
	useRegisterFilesPane({
		sessionId,
		cwd: sessionDirectory ?? undefined,
		windowFiles,
		windowStartIndex: transcript.startIndex,
		jumpTargetWindow,
	});
	const sessionArtifacts = useSessionArtifacts(sessionId);
	useRegisterArtifactsPane(sessionArtifacts);
	const planModel = useMemo(() => sessionPlanModel(processed.lines), [processed.lines]);
	useRegisterPlanPane(data.planFilename, planModel);
	useRegisterLinksPane({
		sessionId,
		lines: processed.lines,
		windowStartIndex: transcript.startIndex,
		jumpTargetWindow,
	});
	useIdlePrefetch(SESSION_PANE_CHUNKS);
	const {hookContexts, runningSubagents, pendingTools} = useClaudeEvents();
	const hookContext = hookContexts.get(sessionId);
	const transcriptActiveSubagents = useMemo(() => extractPendingSubagents(transcript.records), [transcript.records]);
	const activeSubagents = useMemo(() => {
		const eventSubagents: ActiveSubagent[] = [...runningSubagents.values()]
			.filter((subagent) => subagent.sessionId === sessionId)
			.map((subagent) => ({
				key: getSubagentLifecycleKey(subagent.sessionId, subagent.agentId, subagent.agentType),
				...subagent,
			}));
		return eventSubagents.length > 0 ? eventSubagents : transcriptActiveSubagents;
	}, [sessionId, runningSubagents, transcriptActiveSubagents]);
	const [aiSummary, setAiSummary] = useState<string | null>(data.summary ?? null);
	const isActive = useIsSessionActive(sessionId);
	const [lastInterrupt, setLastInterrupt] = useState<{sessionId: string; at: number} | null>(null);
	const notifications = useQuery({
		...notificationsQueryOptions(),
		select: (data) => data.notifications,
	}).data;
	const sessionSummary = useCachedSessionSummary(sessionId);
	const sessionPermissionWait = sessionSummary?.awaitingPermission === true;
	const permissionWaitId = useMemo(
		() =>
			permissionWaitToolUseId({
				sessionId,
				notifications: notifications ?? [],
				records: transcript.records,
				awaitingPermission: sessionPermissionWait,
			}),
		[sessionId, notifications, transcript.records, sessionPermissionWait],
	);
	const awaitingPermission = permissionWaitId !== null;
	const sessionSummaryState = sessionSummary?.state ?? null;
	const hookQuestion = useQuery({
		...pendingQuestionQueryOptions(sessionId),
		// Only a waiting session can have one; SSE patches the cache either way.
		enabled: sessionSummaryState === "waiting",
		select: (data) => data.pendingQuestion,
	}).data;
	const workingMarkerState = useWorkingMarkerState({
		records: transcript.records,
		sessionState: sessionSummaryState,
		isActive,
		pendingToolName: pendingTools.get(sessionId)?.toolName,
		interruptedAt: lastInterrupt?.sessionId === sessionId ? lastInterrupt.at : null,
		awaitingPermission,
	});
	// The turn's in-flight call has its own running row in the transcript (a subagent's row stays a plain link).
	const pendingCall = useMemo(() => findLastPendingToolUse(transcript.records), [transcript.records]);
	const inFlightRow =
		workingMarkerState.status === "working" &&
		pendingCall !== null &&
		pendingCall.name !== "Agent" &&
		pendingCall.name !== "Task";
	const backgroundTasks = useMemo(
		() =>
			extractBackgroundTasks(transcript.records, {
				sessionActive: sessionProcessLive({hookActive: isActive, summaryState: sessionSummaryState}),
				processStartedAt: sessionSummary?.processStartedAt ?? null,
				teammates: subagents,
				runningSubagents: activeSubagents,
				...(hookContext?.backgroundTasks === undefined ? {} : {hookTasks: hookContext.backgroundTasks}),
			}),
		[
			transcript.records,
			isActive,
			sessionSummaryState,
			sessionSummary?.processStartedAt,
			subagents,
			activeSubagents,
			hookContext?.backgroundTasks,
		],
	);
	useRegisterBackgroundTasksPane(sessionId, backgroundTasks, subagents.length);
	const runningBackgroundLaunches = useMemo(
		() => new Set(backgroundTasks.running.flatMap((task) => (task.toolUseId === null ? [] : [task.toolUseId]))),
		[backgroundTasks],
	);
	useRegisterSubagentPane({sessionId, subagents, records: transcript.records});
	const statusline = useStatusline(sessionId);
	useRegisterSessionDetailsPane(statusline, data.messageCount);
	const composerServerState = useComposerServerState(sessionId);
	const composerChin = useMemo(
		() =>
			resolveComposerState({
				hookPermissionMode: hookContext?.permissionMode,
				jsonlPermissionMode: lastPermissionModeFromRecords(transcript.records),
				settingsDefaultMode: composerServerState?.settingsDefaultMode ?? null,
				statuslineModel: composerServerState?.statusline?.model?.display_name ?? null,
				statuslineModelId: composerServerState?.statusline?.model?.id ?? null,
				lastAssistantModel: lastAssistantModelFromRecords(transcript.records),
				lastAssistantUsage: lastAssistantUsageFromRecords(transcript.records),
				lastAssistantEffort: lastAssistantEffortFromRecords(transcript.records),
				settingsModel: composerServerState?.settingsModel ?? null,
				settingsEffortLevel: composerServerState?.settingsEffortLevel ?? null,
				statusline: composerServerState?.statusline ?? null,
				statuslineUpdatedAt: composerServerState?.statuslineUpdatedAt ?? null,
			}),
		[hookContext?.permissionMode, transcript.records, composerServerState],
	);
	const {data: slashCommands} = useQuery({
		...slashCommandsQueryOptions(sessionDirectory ?? undefined),
		enabled: Boolean(sessionDirectory),
	});
	const {data: promptHistory} = useQuery({
		...promptHistoryQueryOptions(sessionId),
		enabled: Boolean(sessionDirectory),
	});
	const [generating, setGenerating] = useState(false);
	const summaryMutation = useRequestSummary(sessionId);
	const chromeHidden = settings.chromeHidden;
	const setChromeHidden = useCallback(
		(v: boolean) => {
			setSetting("chromeHidden", v);
		},
		[setSetting],
	);
	const chromeShortcut = useShortcutKeys("expand_collapse_pane");
	const toggleChromeHidden = useCallback(() => {
		setChromeHidden(!chromeHidden);
	}, [chromeHidden, setChromeHidden]);

	const answerRoute = sessionAnswerRoute({sessionId, hookActive: isActive, summary: sessionSummary, herdr});
	const submitAnswer = useCallback(
		async ({toolUseId, questions, answers}: AnswerSubmission) => {
			const {submitQuestionAnswer} = await import("../lib/question-answer-submit");
			await submitQuestionAnswer(answerRoute, {sessionId, toolUseId, questions, answers});
		},
		[answerRoute, sessionId],
	);
	const pendingQuestion = useMemo(() => findPendingAskUserQuestion(transcript.records), [transcript.records]);
	// The ephemeral Usage card, keyed to the session it was opened in.
	const [usageCardSessionId, setUsageCardSessionId] = useState<string | null>(null);
	const showUsageBreakdown = useCallback(() => {
		setUsageCardSessionId(sessionId);
	}, [sessionId]);
	// Upstream draws a pending question inline as its card; one in the transcript answers there while the session runs.
	const inlineQuestion = isActive ? pendingQuestion : null;
	const chatStream = useChatStream();
	const toast = useToast();
	const forkSession = useSessionFork();
	const forkCwd = data.cwd ?? data.projectPath ?? null;
	const forkFromMessage =
		forkCwd === null
			? undefined
			: (target: {sessionId: string; atMessage: string}) => {
					forkSession({...target, cwd: forkCwd});
				};
	const liveHerdrPrompt = useLiveHerdrPrompt(sessionId, endIndex);
	const promptBehavior = getSessionPromptBehavior(sessionId, isActive, herdr);
	const stopAvailable = canStopResponse({
		hasLivePane: promptBehavior.hasLivePane,
		writesEnabled: herdr.writesEnabled,
		working: workingMarkerState.status !== "idle",
	});
	const bypassPermissionsAllowed = composerServerState?.settingsBypassPermissionsAllowed ?? false;
	const liveModes = useMemo(
		() => modeMenuItems(bypassPermissionsAllowed).map((item) => item.id),
		[bypassPermissionsAllowed],
	);
	const liveLaunch = useLiveLaunchOptions({
		sessionId,
		currentMode: composerChin.mode?.id ?? "default",
		availableModes: liveModes,
		hookContext,
		toast,
	});
	const liveLaunchAvailable = canApplyLive({
		hasLivePane: promptBehavior.hasLivePane,
		writesEnabled: herdr.writesEnabled,
		working: workingMarkerState.status !== "idle",
	});
	const onInterrupt = useCallback(
		(at: number) => {
			setLastInterrupt({sessionId, at});
		},
		[sessionId],
	);
	const onInterruptError = useCallback(
		(error: unknown) => {
			toast({
				kind: "error",
				message: "Couldn't stop the response",
				description: error instanceof Error ? error.message : String(error),
			});
		},
		[toast],
	);
	const pendingPermission = useMemo(
		() =>
			inlineQuestion === null
				? findPendingPermission({
						sessionId,
						isActive,
						notifications: notifications ?? [],
						records: transcript.records,
						awaitingPermission: sessionPermissionWait,
					})
				: null,
		[isActive, inlineQuestion, sessionId, notifications, transcript.records, sessionPermissionWait],
	);
	const hookQuestionToolUseId = hookQuestion?.toolUseId;
	const answerHookQuestion = useCallback(
		async (answers: Array<QuestionAnswer | null>) => {
			if (hookQuestionToolUseId !== undefined) {
				await sendHerdrQuestionAnswer(sessionId, hookQuestionToolUseId, answers);
			}
		},
		[sessionId, hookQuestionToolUseId],
	);
	const askUserQuestionCtx: AskUserQuestionContextValue = useMemo(
		() => ({answerRoute, submitAnswer}),
		[answerRoute, submitAnswer],
	);
	const answerPermission = useCallback(
		async (decision: PermissionDecision) => sendHerdrPermissionDecision(sessionId, decision),
		[sessionId],
	);
	const stopResponse = useStopResponse({
		sessionId,
		// Esc denies the docked permission prompt instead of stopping the turn.
		enabled: stopAvailable && pendingPermission === null,
		onInterrupt,
		onError: onInterruptError,
	});
	const composerGate = composerPendingGate({
		hookQuestion,
		transcriptQuestion: inlineQuestion !== null,
		awaitingPermission,
	});
	const paneBusy = workingMarkerState.status !== "idle" || liveHerdrPrompt.state.isPending;
	const queueBusy = paneBusy || gateHoldsQueue(composerGate);
	const interruptForSendNow = useCallback(() => {
		onInterrupt(Date.now());
		sendHerdrInterrupt(sessionId, false).catch(onInterruptError);
	}, [onInterrupt, onInterruptError, sessionId]);
	const composerQueue = useComposerQueue({
		sessionId,
		busy: queueBusy,
		dialogOpen: gateHoldsQueue(composerGate),
		deliver: liveHerdrPrompt.send,
		interrupt: interruptForSendNow,
	});
	const {enqueue: enqueuePrompt, items: queuedPrompts} = composerQueue;
	const {send: composerSend} = composerSendPlan(composerGate, {busy: paneBusy, queued: queuedPrompts.length});
	const sendLivePrompt = useCallback(
		async (prompt: string) => {
			switch (composerSend.kind) {
				case "dismiss-question-then-queue":
					// Upstream: a message sent under a question answers it as skipped, then goes in right away;
					// the queue types it mid-turn as soon as the hooks show the dialog closed.
					enqueuePrompt(prompt, {midTurn: true});
					try {
						await sendHerdrQuestionAnswer(sessionId, composerSend.toolUseId, composerSend.answers);
					} catch (error) {
						toast({
							kind: "error",
							message: "Couldn't skip the question",
							description: error instanceof Error ? error.message : String(error),
						});
					}
					return;
				case "queue":
					// Enter while working, or while the pane shows a dialog, queues; the queue flushes on the next idle.
					enqueuePrompt(prompt);
					return;
				case "send":
					if ((await liveHerdrPrompt.send(prompt)) === "not-ready") enqueuePrompt(prompt);
					return;
				default:
					assertNever(composerSend);
			}
		},
		[composerSend, enqueuePrompt, liveHerdrPrompt, sessionId, toast],
	);
	const paneState: ComposerPaneState = promptBehavior.hasLivePane
		? workingMarkerState.status === "idle"
			? "idle"
			: "working"
		: "none";
	const submitComposer = (submit: ComposerSubmit, prompt: string, launchOptions: LaunchOptions) =>
		dispatchComposerSubmit(
			{
				sessionId,
				cwd: data.cwd ?? data.projectPath ?? "",
				pane: paneState,
				writesEnabled: herdr.writesEnabled,
				submit,
				prompt,
				launchOptions,
			},
			{
				sendLive: (livePrompt) => void sendLivePrompt(livePrompt),
				sendForkStream: (forkedPrompt, options) => void chatStream.send(sessionId, forkedPrompt, options),
				launchFork: (launch) =>
					void launchPromptFork(launch, sessionId, {
						launch: launchHerdrSession,
						onLaunched: setPendingFork,
						toast,
						now: Date.now,
					}),
			},
		);
	const shellsEnabled =
		useQuery({
			...applicationSettingsQueryOptions,
			select: (settings) => settings.shellPaneEnabled,
		}).data ?? false;
	useRegisterTerminalPane(sessionId, {
		livePane: promptBehavior.hasLivePane,
		interactive: promptBehavior.hasLivePane && herdr.writesEnabled,
		shells: shellsEnabled,
	});
	const prevSessionIdRef = useRef(sessionId);

	useEffect(() => {
		if (prevSessionIdRef.current !== sessionId) {
			prevSessionIdRef.current = sessionId;
			chatStream.reset();
		}
	}, [sessionId, chatStream]);

	// Hide the streamed reply once the JSONL has caught up. Otherwise the
	// stream bubble (kept around by isComplete) and the new transcript line
	// from SSE both render the same text — visible as a duplicate message.
	const completionRecordCountRef = useRef<number | null>(null);
	useEffect(() => {
		if (chatStream.state.isStreaming) {
			completionRecordCountRef.current = null;
			return;
		}
		if (!chatStream.state.isComplete) return;
		if (completionRecordCountRef.current === null) {
			completionRecordCountRef.current = endIndex;
			return;
		}
		if (endIndex > completionRecordCountRef.current) {
			completionRecordCountRef.current = null;
			chatStream.reset();
		}
	}, [chatStream, chatStream.state.isStreaming, chatStream.state.isComplete, endIndex]);

	useEffect(() => {
		setAiSummary(data.summary ?? null);
	}, [sessionId, data.summary]);

	const sessionCommands = createSessionCommands(sessionId, sessionDirectory);

	async function handleGenerateSummary() {
		setGenerating(true);
		try {
			const result = await summaryMutation.mutateAsync();
			if (result.summary) {
				setAiSummary(result.summary);
			}
		} finally {
			setGenerating(false);
		}
	}

	return (
		<div
			className="h-full min-h-0"
			data-perf-session={sessionId}
			data-perf-session-route={routeId === sessionId ? undefined : routeId}
			style={transcriptWidthStyle(settings.transcriptWidth)}
		>
			<TileHost
				sessionId={sessionId}
				onExpandWithoutPane={toggleChromeHidden}
				requestedPane={requestedPane}
				onRequestedPaneHandled={onRequestedPaneHandled}
			>
				<TerminalPaneShortcut available={promptBehavior.hasLivePane || shellsEnabled} />
				<FilesPaneShortcut />
				<ChangesPaneShortcut />
				<RailTileFrame
					railInputs={{
						sessionId,
						homeRoot: data.homeRoot,
						cwd: sessionDirectory,
						gitBranch: data.gitBranch,
						model: composerChin.model,
						herdrPane: herdr.panes.find((pane) => pane.sessionId === sessionId) ?? null,
						mode: composerChin.mode?.label ?? null,
						effort: composerChin.effort.label,
						usage: composerChin.usage,
						todos: planModel.todos,
						artifacts: sessionArtifacts,
						backgroundTasks,
						pr: data.pr ?? null,
						prStatus: data.prStatus ?? null,
					}}
					sessionId={sessionId}
					anchorRef={sessionViewRef}
					visitKey={initialScrollKey}
					positionRef={tileScrollPosition}
					restoredScrollY={restoredScrollPosition?.scrollY}
					header={
						<>
							{/* Sticky header: titlebar + hook context */}
							{!chromeHidden && (
								<div data-transcript-sticky-header className={SESSION_STICKY_HEADER_CLASS}>
									<SessionTitlebar
										sessionId={sessionId}
										data={data}
										isActive={isActive}
										local={{
											resumeCommand: sessionCommands.resume,
											forkCommand: sessionCommands.fork,
											onGenerateSummary:
												aiSummary === null && settings.showSummaryButton
													? () => void handleGenerateSummary()
													: undefined,
											generatingSummary: generating,
										}}
										summary={aiSummary}
										transcriptView={transcriptView}
										paneToggles={
											<SessionPaneControls
												railAvailable
												facts={{
													artifactCount: sessionArtifacts.length,
													hasPlan: hasSessionPlan(data.planFilename, planModel),
													backgroundTasks: backgroundTasksFacts(
														backgroundTasks,
														subagents.length,
													),
													subagentCount: subagents.length,
												}}
												onExpandChat={() => {
													setChromeHidden(true);
												}}
											/>
										}
									/>
									<SessionAiTitleLine title={data.title} aiTitle={data.aiTitle} />

									{hookContext && (
										<SessionHookContext
											context={hookContext}
											verbose={transcriptMode === "verbose"}
										/>
									)}
									<ChapterChips sessionId={sessionId} onJump={requestMessageJump} />
								</div>
							)}

							{/* Floating restore button when chrome is hidden */}
							{chromeHidden && (
								<div className="sticky top-0 z-10 flex justify-end py-1">
									<Tooltip
										content="Show header and footer"
										shortcut={chromeShortcut.keys}
										side="bottom"
									>
										<button
											type="button"
											onClick={() => {
												setChromeHidden(false);
											}}
											className="rounded-md bg-surface-0 border border-border px-2 py-1 text-xs text-t6 hover:text-primary hover:bg-fill-control transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
											aria-keyshortcuts={chromeShortcut.ariaKeyShortcuts}
										>
											<Minimize2 className="h-3 w-3" />
											Show chrome
										</button>
									</Tooltip>
								</div>
							)}
						</>
					}
					footer={
						<>
							{/* Sticky footer: the composer dock, opaque to the viewport bottom with a fade over the transcript */}
							<div
								data-session-footer
								className="sticky bottom-0 z-10 shrink-0 pb-[var(--session-dock-bottom,max(env(safe-area-inset-bottom),9px))] bg-page before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-8 before:bg-linear-to-b before:from-transparent before:to-page"
							>
								<div className={!chromeHidden && sessionDirectory ? "pt-2" : ""}>
									<SessionDock
										anchorRef={scrollAnchorRef}
										needsInput={
											pendingQuestion !== null ||
											pendingPermission !== null ||
											(sessionSummaryState === "waiting" &&
												hookQuestion !== undefined &&
												hookQuestion !== null)
										}
									>
										{!chromeHidden &&
											sessionDirectory &&
											(data.pr !== undefined || data.prStatus !== undefined) && (
												<BranchStrip
													sessionId={sessionId}
													session={data}
													statusline={statusline}
												/>
											)}
										{!chromeHidden &&
											sessionDirectory &&
											settings.showChangesStrip &&
											data.pr === undefined &&
											data.prStatus === undefined && (
												<BranchStrip
													sessionId={sessionId}
													session={data}
													statusline={statusline}
												/>
											)}
										{/* With no question to draw inline, a waiting session says it needs input above the composer */}
										{showsWaitingForInputNotice({
											state: sessionSummaryState,
											hasDockedCard: inlineQuestion !== null || pendingPermission !== null,
										}) &&
											!hookQuestion && <WaitingForInputNotice />}
										{/* Upstream sets the usage chip between the docked card and the composer */}
										{!chromeHidden && sessionDirectory && <UsagePaceBanner />}
										{!chromeHidden && sessionDirectory && <NotifyMePrompt sessionId={sessionId} />}
										{!chromeHidden && sessionDirectory && (
											<Composer
												variant="session"
												draftKey={sessionId}
												onSend={(prompt, launchOptions) => {
													if (
														handleBtwPrompt(prompt, {
															sessionId,
															messageCount: data.messageCount,
															toast,
														})
													) {
														return;
													}
													submitComposer("send", prompt, launchOptions);
												}}
												onFork={(prompt, launchOptions) =>
													submitComposer("fork", prompt, launchOptions)
												}
												forkLabel={forkSubmitLabel({
													pane: paneState,
													writesEnabled: herdr.writesEnabled,
												})}
												onCancel={() => {
													void chatStream.cancel();
												}}
												isStreaming={!promptBehavior.usesHerdr && chatStream.state.isStreaming}
												onStop={stopAvailable ? stopResponse : undefined}
												disabled={
													promptBehavior.disabled ||
													(!promptBehavior.usesHerdr && liveHerdrPrompt.state.isPending)
												}
												queue={promptBehavior.usesHerdr ? composerQueue : undefined}
												onSendNow={
													promptBehavior.usesHerdr ? composerQueue.sendNowText : undefined
												}
												deliveryHint={promptBehavior.deliveryHint}
												chin={composerChin}
												onShowUsageBreakdown={showUsageBreakdown}
												slashCommands={slashCommands}
												bypassPermissionsAllowed={bypassPermissionsAllowed}
												live={liveLaunchAvailable ? liveLaunch : undefined}
												mentionSessionId={sessionId}
												promptHistory={promptHistory}
											/>
										)}
									</SessionDock>
								</div>
							</div>
						</>
					}
				>
					<LegacyMessageLinkNotice hash={locationHash} />

					{/* The transcript spans the page padding; the chat column's own gutters inset it, as on upstream */}
					<div className="flex-1">
						<TranscriptTopFade />
						{/* Chat messages */}
						<AskUserQuestionProvider value={askUserQuestionCtx}>
							<TranscriptHistoryLoader sessionId={sessionId} startIndex={transcript.startIndex} />
							<SessionFileRefs
								sessionId={sessionId}
								cwd={sessionDirectory ?? undefined}
								sessionFiles={resources?.files ?? windowFiles}
							>
								<SessionSubagentOpener sessionId={sessionId}>
									<SessionBackgroundTasksOpener running={runningBackgroundLaunches}>
										<TranscriptActionsProvider
											sessionId={sessionId}
											lines={processed.lines}
											fork={forkFromMessage}
										>
											<SessionChat
												sessionId={sessionId}
												lines={processed.lines}
												measurementSource={transcript.records}
												measurementLayout={JSON.stringify([
													settings.showDebug,
													settings.interfaceFont,
													settings.transcriptTextSize,
													settings.codeFont,
													settings.transcriptWidth,
												])}
												toolResultMap={processed.toolResultMap}
												allowedImageRoots={data.imageRoots}
												subagents={subagents}
												showThinking={transcriptFlags.showThinking}
												showTools={transcriptFlags.showTools}
												showPassedHooks={transcriptFlags.showPassedHooks}
												showHookWarnings={transcriptFlags.showHookWarnings}
												showHookErrors={transcriptFlags.showHookErrors}
												showSystemBanners={transcriptFlags.showSystemBanners}
												showCompactSummaries={transcriptFlags.showCompactSummaries}
												showTranscriptOnly={transcriptFlags.showTranscriptOnly}
												transcriptMode={transcriptMode}
												permissionWaitToolUseId={permissionWaitId}
												initialScrollKey={initialScrollKey}
												scrollContentRef={scrollAnchorRef}
												shouldScrollToEnd={
													restoredScrollPosition === undefined && locationHash === ""
												}
												summary={aiSummary}
												{...(slashCommands === undefined ? {} : {slashCommands})}
											/>
										</TranscriptActionsProvider>
									</SessionBackgroundTasksOpener>
								</SessionSubagentOpener>
							</SessionFileRefs>
						</AskUserQuestionProvider>

						{/* Upstream draws every pending approval inline; a permission prompt is not on disk, so it follows the transcript */}
						{pendingPermission && (
							<div data-inline-permission="" className={`${CHAT_COLUMN_CLASS} pb-4`}>
								<PermissionCard
									key={pendingPermission.notificationId}
									title={pendingPermission.title}
									command={pendingPermission.command}
									canAnswer={promptBehavior.hasLivePane && herdr.writesEnabled}
									persistentAllow={pendingPermission.persistentAllow ?? null}
									onDecision={answerPermission}
									footer={
										<Suspense fallback={null}>
											<ToolApprovalNotifyTip sessionId={sessionId} />
										</Suspense>
									}
								/>
							</div>
						)}
						{/* The CLI writes a question to the JSONL only once answered, so its hook copy is drawn inline at the transcript's end */}
						{sessionSummaryState === "waiting" &&
							hookQuestion &&
							pendingQuestion?.toolUseId !== hookQuestion.toolUseId && (
								<div data-hook-question="" className={`${CHAT_COLUMN_CLASS} pb-4`}>
									<QuestionCard
										key={hookQuestion.toolUseId}
										questions={hookQuestion.questions}
										onSubmit={answerRoute === "live-pane" ? answerHookQuestion : undefined}
									/>
								</div>
							)}
						{(chatStream.state.isStreaming || chatStream.state.isComplete) && (
							<StreamingMessage
								text={chatStream.state.text}
								isComplete={chatStream.state.isComplete}
								error={chatStream.state.error}
								forkedSessionId={chatStream.state.forkedSessionId}
								sentPrompt={chatStream.state.sentPrompt}
							/>
						)}

						{liveHerdrPrompt.state.prompt !== "" && (
							<StreamingMessage
								text=""
								isComplete={!liveHerdrPrompt.state.isPending}
								error={liveHerdrPrompt.state.error || undefined}
								sentPrompt={liveHerdrPrompt.state.prompt}
								pendingLabel="Sent to live session — waiting for transcript..."
							/>
						)}

						{usageCardSessionId === sessionId && (
							<Suspense fallback={null}>
								<div ref={(node) => node?.scrollIntoView({block: "nearest"})}>
									<SessionUsageCard records={transcript.records} limits={composerChin.usage} />
								</div>
							</Suspense>
						)}

						<WorkingMarker state={tailMarkerState(workingMarkerState, inFlightRow)} />

						{!inFlightRow && <RunningTasksControl count={backgroundTasks.running.length} />}

						<SideChat sessionId={sessionId} messageCount={data.messageCount} />
					</div>
				</RailTileFrame>
			</TileHost>
		</div>
	);
}
