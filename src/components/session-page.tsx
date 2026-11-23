import {SESSION_FOOTER_CLASS} from "./dock-tokens";
import {useOpenCustomize} from "./customize/open-customize";
import {SessionSkeleton} from "./session-skeleton";
import {SessionNotFound} from "./session-unavailable";
import {sessionScrollKey} from "../lib/session-route-location";
import {useLocation, useNavigate} from "@tanstack/react-router";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import
{
	Fragment,
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ComponentProps,
} from "react";
import {Minimize2} from "lucide-react";
import {SessionTileFrame} from "./session-tile-frame";
import {latestBreakdown, preferNewerBreakdown, railContextPercent} from "../lib/context-breakdown";
import {sessionContextBreakdownQueryOptions} from "../lib/api/context-breakdown";
import {latestRecordVersion, resolveStaleEngine} from "../lib/stale-engine";
import {customizeMcpServersQueryOptions, sessionConnectors} from "../lib/api/customize";
import {usageQueryOptions} from "../lib/api/usage";
import {focusComposer, getComposerText, refillComposer, refillRejectedSend, takeBackSend} from "../lib/context-attach";
import {rewindStepsBack, rewindTurns} from "../lib/rewind-picker";
import {SessionRailSlot} from "./session-rail/session-rail-slot";
import {useSlashRemoteControl} from "../hooks/use-remote-control-toggle";
import
{
	SessionRailFitContext,
	useSessionRailDocked,
	useSessionRailFitState,
} from "./session-rail/use-session-rail-docked";
import type {SessionRailInputs} from "./session-rail/session-rail-cards";
import {SessionChat} from "./session-chat";
import {LiveSessionStatusCard, LiveStatusSourcesProvider} from "./session-status-card";
import {TranscriptRevisionContext} from "./transcript-revision-context";
import {useOpenSettings} from "./settings/open-settings";
import {appendClientRow, type ClientRow, lastRecordUuid} from "../lib/client-rows-store";
import {TranscriptTailContext} from "./transcript-tail-context";
import {SessionChaptersToc} from "./session-chapters-toc";
import {TranscriptActionsProvider} from "./transcript-actions-provider";
import {SessionTurnProvider} from "./session-turn-provider";
import {useSessionFork} from "../hooks/use-session-fork";
import {useLimitAutoResume} from "../hooks/use-limit-auto-resume";
import {useRespondingHere} from "../hooks/use-responding-here";
import {ArchivedComposerNote} from "./archived-composer-note";
import {Composer, type ComposerRewindState} from "./composer";
import type {UsageRingContext} from "./usage-popover-context";
import {formatSendTime} from "../lib/timestamp-format";
import {FailedUserRow, HeldUserRow, SendingUserRow} from "./pending-user-row";
import {StreamingMessage} from "./streaming-message";
import {HeldSteerTurns, OptimisticWaitingTurn, ParkedWaitingTurns} from "./waiting-user-turn";
import {SessionHookContext} from "./session-hook-context";
import {useSettings} from "./settings-context";
import {useTranscriptModeShortcut} from "../hooks/use-session-transcript-mode";
import {sessionHasThinking} from "../lib/transcript-mode";
import {SessionTitlebar} from "./session-titlebar";
import {sessionTitlePending} from "../lib/session-stand-in-title";
import {SessionAiTitleLine} from "./session-ai-title-line";
import {SESSION_LIFTED_HEADER_CLASS, SESSION_STICKY_HEADER_CLASS} from "./titlebar-classes";
import {LiftedHeader} from "./panes/wide-title-row";
import {syncUnseenFromSummaries} from "../lib/unread-store";
import
{
	AskUserQuestionProvider,
	type AnswerSubmission,
	type AskUserQuestionContextValue,
} from "./ask-user-question-context";
import type {PlanApprovalContextValue} from "./plan-approval-context";
import {SessionFileRefs} from "./file-refs";
import type {JumpTargetWindow} from "./jump-target-context";
import {LegacyMessageLinkNotice} from "./legacy-message-link-notice";
import {TileHost} from "./panes/tile-host";
import {PlanAutoOpen} from "./plan-auto-open";
import {useRegisterArtifactsPane, useSessionArtifacts} from "./panes/artifacts-pane-entry";
import
{
	preloadBackgroundTasksPane,
	useRegisterBackgroundTasksPane,
	useVisibleBackgroundTasks,
} from "./panes/background-tasks-pane-entry";
import {preloadLinksPane, useRegisterLinksPane} from "./panes/links-pane-entry";
import {useRegisterSessionDetailsPane} from "./panes/session-details-pane-entry";
import {useRegisterSubagentPane} from "./panes/subagent-pane-entry";
import {SessionBackgroundTasksOpener, SessionSubagentOpener} from "./subagent-opener";
import {hasSessionPlan, useRegisterPlanPane} from "./panes/plan-pane-entry";
import {sessionPlanModel, withPendingPlan} from "../lib/session-plan-model";
import {useRegisterChangesPane} from "./changes/changes-pane-entry";
import {ChangesPaneShortcut} from "./changes/changes-pane-shortcut";
import {preloadFilesPane, useRegisterFilesPane} from "./panes/files-pane-entry";
import {FilesPaneShortcut} from "./panes/files-pane-shortcut";
import {useExtractedSessionFiles} from "./panes/session-file-sources";
import {PalettePaneCommandsPublisher} from "./panes/palette-pane-commands-publisher";
import {TerminalPaneShortcut} from "./panes/terminal-pane-shortcut";
import {preloadTerminalPane, useRegisterTerminalPane} from "./panes/terminal-pane-entry";
import {useStartHerdrTerminal} from "../hooks/use-herdr-terminal";
import {BranchStrip} from "./branch-strip";
import {TranscriptHistoryLoader} from "./transcript-history-loader";
import {Tooltip} from "./ui/tooltip";
import {SessionPaneControls} from "./view-options-menu";
import {SessionDock} from "./session-dock";
import {ApprovalAlsoWaiting} from "./approval-also-waiting";
import {ApprovalArrivalRegion} from "./approval-arrival-region";
import {ApprovalClusterHost} from "./approval-cluster-host";
import {ApprovalDockContext, type ApprovalDock} from "./approval-dock-context";
import {pendingQuestionCard} from "./pending-question-card";
import {useApprovalPresentation} from "../hooks/use-approval-presentation";
import {ComposerNoticeProvider, ComposerNoticeRegion} from "./composer-notice-region";
import {sessionProcessLive} from "../lib/session-state";
import {sessionComposerFastMode} from "../lib/session-fast-mode";
import {sessionAdvisorModel} from "../lib/advisor";
import {sessionOutputStylesQueryOptions} from "../lib/api/output-styles";
import {outputStyleItems} from "../lib/output-style-options";
import {sessionOutputStyle} from "../lib/session-output-style";
import {useMemoryDialogLoad} from "../hooks/use-memory-dialog-load";
import {type QueuedPrompt, parkedPrompts, steeredPrompts} from "../lib/composer-queue";
import {LOCAL_ENVIRONMENTS_ON, parkedListInTranscript} from "../lib/parked-prompts";
import {recallLastHeldSteer} from "../lib/steer-recall";
import
{
	tailMarkerQuiet,
	toolLabelSince,
	turnTokenUsage,
	workingLineUnderCard,
	workingLineWaitsOnUser,
	type WorkingLineToolLabel,
} from "../lib/working-marker";
import {WaitingForInputNotice} from "./approval-card";
import {UrlElicitationDock} from "./url-elicitation-dock";
import {RefusalFallbackDock} from "./refusal-fallback-dock";
import {QuestionCard} from "./question-card";
import {ApprovalSlot} from "./approval-slot";
import {sessionApprovalSlotCard} from "../lib/approval-slot-card";
import {showsWaitingForInputNotice} from "./waiting-for-input-notice";
import {NotifyMePrompt} from "./notify-me-prompt";
import {type HeldNotice, UsagePaceBanner} from "./usage-pace-banner";
import {WorkflowSizeWarningNotice} from "./workflow-size-warning-notice";
import {SessionAutoModeSetupBand} from "./auto-mode-setup-band";
import {ColdResumeNotice} from "./cold-resume-notice";
import {type RefusalFallbackHost, RefusalFallbackHostContext} from "./refusal-fallback-host";
import {startSessionOnModel} from "../lib/start-session-on-model";
import {activeRefusalFallback} from "../lib/refusal-fallback";
import {HARD_BLOCK_CARDS, hardBlockAt, latestHardBlock} from "../lib/hard-block";
import {type HardBlockHost, HardBlockHostContext} from "./hard-block-host";
import {settingsModelMenu} from "../lib/retry-model-items";
import {newestRecordMs, usageWindowSpent} from "../lib/cold-resume-notice";
import
{
	STALE_COMPACT_FLOOR,
	decideStaleCompact,
	lastEntryIsAssistantReply,
	staleCompactSlot,
	type StaleCompactAdvisory,
} from "../lib/stale-compact";
import {useStaleCompactIdle} from "../hooks/use-stale-compact-idle";
import type {StaleCompactBandProps} from "./stale-compact-band";
import {requestHomeComposerFocus, requestHomeLaunchFolder} from "../lib/home-composer-focus";
import {WorkingMarker} from "./working-marker";
import {useWorkingMarkerState} from "./use-working-marker-state";
import {usePermissionAnswer} from "./use-permission-answer";
import {usePermissionDialogShape} from "./use-permission-dialog-shape";
import type {SessionAutoSwitch} from "./session-permission-card";
import {autoSwitchOffered} from "../lib/permission-auto-switch";
import {consentWorkspaceKey} from "../lib/permission-mode-consent";
import {SideChat} from "./side-chat";
import {preloadSideChatPanel} from "./side-chat-panel-module";
import {preloadErrorRecoveryActions} from "./error-recovery-actions-entry";
import {handleBtwPrompt} from "./btw-prompt";
import {useSideChatShortcut} from "./use-side-chat-shortcut";
import {useToast} from "./toast-context";
import {transcriptWidthStyle} from "../lib/transcript-width";
import {useChatStream} from "../hooks/use-chat-stream";
import {promptHistoryQueryOptions} from "../lib/api/prompt-history";
import {useShortcutKeys} from "../hooks/use-shortcut";
import {useSlashCommands} from "../hooks/use-slash-commands";
import {useLiveLaunchOptions} from "../hooks/use-live-launch-options";
import {useFolderModeMemory} from "../hooks/use-folder-mode-memory";
import {useModeBadges} from "../hooks/use-mode-badges";
import {useRewindPicker} from "../hooks/use-rewind-shortcut";
import {useRewindRequest} from "../hooks/use-rewind-request";
import {useHardBlockEditRetry} from "../hooks/use-hard-block-edit-retry";
import {useRefusalEditRetry} from "../hooks/use-refusal-edit-retry";
import {useRefusalFallbackDialog} from "../hooks/use-refusal-fallback-dialog";
import {canStopResponse, useStopResponse} from "../hooks/use-stop-response";
import {useBackgroundTaskStop} from "../hooks/use-background-task-stop";
import {useNestedStop} from "../hooks/use-nested-stop";
import {latestAgentsKilledId, nestedStopCount} from "../lib/nested-stop";
import {SEND_NOW_FAILED_MESSAGE, useComposerQueue} from "../hooks/use-composer-queue";
import {useParkedPrompts} from "../hooks/use-parked-prompts";
import
{
	type ComposerPaneState,
	type ComposerSubmit,
	dispatchComposerSubmit,
	forkSubmitLabel,
	signInRunsInTerminal,
	launchPromptFork,
} from "../lib/composer-fork-routing";
import {composerPendingGate, composerSendPlan, gateHoldsQueue} from "../lib/composer-pending-gate";
import {assertNever} from "../lib/assert-never";
import {canApplyLive, effortLevelsFor, type LaunchOptions, modeMenuItems} from "../lib/launch-options";
import {setPendingFork} from "../lib/session-fork";
import {requestRailContextCard} from "../lib/session-rail-store";
import
{
	useClaudeEvents,
	useComposerServerState,
	useIsSessionActive,
	cachedSessionSummary,
	useCachedSessionSummary,
	useStatusline,
} from "../hooks/use-claude-events";
import
{
	lastAssistantEffortFromRecords,
	lastAssistantModelFromRecords,
	lastAssistantUsageFromRecords,
	lastPermissionModeFromRecords,
	resolveComposerState,
	withComposerAccountLimits,
} from "../lib/composer-state";
import {useSessionViewedState} from "../hooks/use-session-viewed-state";
import {usePendingMessageJump} from "../hooks/use-pending-message-jump";
import {useChapterJump} from "../hooks/use-chapter-jump";
import {useSessionChapters} from "../lib/chapter-store";
import {buildSessionChapters} from "../lib/session-chapters";
import {activeGoal} from "../lib/session-goal";
import {useMainScrollRestoration, type MainScrollRestorationSnapshot} from "../hooks/use-main-scroll-restoration";
import
{
	findLastPendingToolUse,
	findPendingAskUserQuestion,
	hookQuestionCardShown as isHookQuestionCardShown,
	liveHookQuestion,
} from "../lib/approval-dock";
import {useApprovalAnswered, useForgetAnsweredHookPlan} from "../lib/answered-approvals";
import {useAnsweredSessionIds} from "../lib/answered-sessions";
import {useQuestionCardSent} from "../lib/question-card-store";
import {applicationSettingsQueryOptions, useSaveApplicationSettings} from "../lib/api/application-settings";
import
{
	herdrPanesQueryOptions,
	launchHerdrSession,
	sendHerdrInterrupt,
	sendHerdrRewind,
	sendHerdrLiveOption,
	sendHerdrElicitationDecision,
	sendHerdrPermissionAllowAuto,
	sendHerdrPermissionDecision,
	sendHerdrPlanDecision,
	fetchHerdrPlanDialog,
	sendHerdrQuestionAnswer,
} from "../lib/api/herdr";
import {notificationsQueryOptions} from "../lib/api/notifications";
import {pendingQuestionQueryOptions} from "../lib/api/pending-question";
import {useLiveApproval} from "../lib/live-approval-sessions";
import {pendingPlanQueryOptions} from "../lib/api/pending-plan";
import {pendingElicitationsQueryOptions} from "../lib/api/pending-elicitations";
import
{
	DeferredInlinePlanApproval,
	DeferredSessionPermissionCard,
	DeferredSendRejectedCard,
	loadSessionPromptCards,
} from "./session-prompt-cards-entry";
import {useSendRejectionActions} from "./use-send-rejection-actions";
import {dockedHookPlan, inlinePlanToolUseId} from "../lib/docked-plan";
import {planText} from "../lib/exit-plan-mode";
import {EMPTY_QUEUED_IDS, queuedRequestIds, sessionApprovalQueue} from "../lib/approval-queue";
import {approvalPlacement, placementDrawsQueue} from "../lib/approval-placement";
import type {PermissionAskEntry} from "../lib/permission-ask";
import {permissionQueue} from "../lib/permission-queue";
import
{
	findElicitationWaitingNotice,
	findPendingElicitationPermissions,
	findUrlElicitationCard,
	findPendingPermission,
	permissionAnswerKey,
	permissionWaitToolUseId,
	type PermissionDecision,
} from "../lib/permission-card";
import {permissionAnnouncement} from "../lib/permission-announcement";
import type {HerdrPaneIndexData} from "../lib/api/herdr";
import type {PaneKind} from "../lib/pane-layout";
import type {QuestionAnswer} from "../lib/hook-events";
import
{
	fetchAllEarlierTranscript,
	sessionDetailQueryOptions,
	sessionQueryKeys,
	sessionResourcesQueryOptions,
	sessionSubagentsQueryOptions,
	sessionWorkflowRunsQueryOptions,
	transcriptEndIndex,
	transcriptQueryOptions,
	useHasEarlierTranscript,
	useRequestSummary,
} from "../lib/api/sessions";
import type {SessionDetailData, SessionSubagentsData, TranscriptData} from "../lib/api/sessions";
import {FindLoadRestContext} from "../lib/find-in-page/list-provider";
import {countMessageRecords} from "../lib/message-count";
import {linesHaveWorkflowCall} from "../lib/workflow-name";
import {getSubagentLifecycleKey, extractPendingSubagents, type ActiveSubagent} from "../lib/subagents";
import {processTranscript} from "../lib/transcript";
import {PeerSendersProvider} from "./peer-senders-provider";
import {backgroundTasksFacts, extractBackgroundTasks} from "../lib/background-tasks";
import {extractOutputFiles, homeOf, mentionOutputFiles} from "../lib/session-outputs";
import {createSessionCommands} from "../lib/session-commands";
import {useIdlePrefetch} from "../hooks/use-idle-prefetch";
import {getSessionPromptBehavior} from "./session-prompt-behavior";
import {sessionAnswerRoute, sessionLiveness} from "../hooks/use-question-answer-route";
import {useLiveHerdrPrompt} from "./use-live-herdr-prompt";
import {runShellCommandInPane} from "../lib/composer-shell-command";
import {useHerdrReconnecting} from "../hooks/use-herdr-reconnecting";
import
{
	errorRecoveryAvailability,
	errorRecoveryHandlers,
	lastEntryIsError,
	sendCompact,
	type CompactDeps,
	switchModelForRetry,
} from "../lib/session-error-recovery";
import {compactActionState} from "../lib/compact-action";
import {TerminalWritesTipProvider} from "./terminal-writes-tip";
import {TurnMarkOutlet, TurnMarkOutletProvider} from "./turn-mark-outlet";
import {TurnPlanBoxCard} from "./turn-plan-box";
import {TranscriptAfterRows} from "./transcript-after-rows";
import {TailActionsOutletContext} from "./tail-actions-context";
import {createTailActionsOutlet} from "../lib/tail-actions-outlet";
import {useTurnMarkStore} from "./turn-mark-context";
import {cardHoldsTranscriptTail, markedRowBelowTailSlot} from "../lib/turn-mark-outlet";
import {usePlanExitHold} from "../lib/plan-exit-hold";
import {planHoldsLoader, turnPlanBox, turnPlanState} from "../lib/turn-plan-box";
import {useSessionMentionProvider} from "../hooks/use-session-mention-provider";
import {sessionMentionsQueryOptions} from "../lib/api/session-mentions";
import {userTextHasSessionMention} from "../lib/mention-sessions";
import {SessionMentionsProvider} from "./session-mention-pill";

/** The deferred pane renderers, prompt cards and side chat panel, warmed once the session page goes idle so their first show is instant. */
const SESSION_PANE_CHUNKS = [
	preloadFilesPane,
	preloadLinksPane,
	preloadTerminalPane,
	preloadBackgroundTasksPane,
	loadSessionPromptCards,
	preloadSideChatPanel,
	preloadErrorRecoveryActions,
];

function SessionChrome({children}: {children: React.ReactNode})
{
	return <div className="h-full overflow-auto">{children}</div>;
}

/**
 * The composer's Background tasks opener only opens the pane (for `/workflows`), so it gets a fixed
 * running map and keeps a stable value as tasks start and stop, sparing the composer re-renders.
 */
const COMPOSER_RUNNING_LAUNCHES: ReadonlyMap<string, string> = new Map();
const EMPTY_PERMISSION_ASKS: readonly PermissionAskEntry[] = [];
/** Asks whose tool draws its own card (the question or plan card), never the permission card. */
const OWN_CARD_ASK_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

/** A pane to open on arrival (the `?pane=` deep link), reported back once handled. */
interface RequestedPaneProps
{
	requestedPane?: PaneKind | undefined;
	onRequestedPaneHandled?: (() => void) | undefined;
}

// The session rail's cards load on its first show.
const SessionRailCards = lazy(async () =>
	import("./session-rail/session-rail-cards").then((module) => (
	{
		default: module.SessionRailCards,
	})),
);

/** The session outline in the chat tile's start gutter, jumping through the transcript's own scroller. */
function SessionOutline({
	requestMessageJump,
	windowStartIndex,
	...props
}: Omit<ComponentProps<typeof SessionChaptersToc>, "onJump"> &
{
	requestMessageJump: (uuid: string) => void;
	windowStartIndex: number;
})
{
	const jump = useChapterJump(props.scrollRef, requestMessageJump, windowStartIndex);
	return <SessionChaptersToc {...props} onJump={jump} />;
}

type RailTileFrameProps = Omit<ComponentProps<typeof SessionTileFrame>, "rail" | "railDocked" | "tileRef"> &
{
	railInputs: SessionRailInputs;
	runningBackgroundLaunches: ReadonlyMap<string, string>;
};

/** The chat tile with the session rail docked at its end while shown and fitting (≥800px beside a side pane under panels). */
function RailTileFrame(props: RailTileFrameProps)
{
	const fit = useSessionRailFitState();
	return (
		<SessionRailFitContext.Provider value={fit}>
			<RailTileFrameBody {...props} measureRef={fit.measureRef} />
		</SessionRailFitContext.Provider>
	);
}

function RailTileFrameBody({
	railInputs,
	runningBackgroundLaunches,
	measureRef,
	...props
}: RailTileFrameProps &
{
	measureRef: (node: HTMLElement | null) => void;
})
{
	const railDocked = useSessionRailDocked();
	return (
		<SessionTileFrame
			{...props}
			railDocked={railDocked}
			tileRef={measureRef}
			rail={
				<SessionRailSlot
					sessionId={railInputs.sessionId}
					render={() => (
						<SessionBackgroundTasksOpener
							sessionId={railInputs.sessionId}
							running={runningBackgroundLaunches}
						>
							<SessionRailCards inputs={railInputs} />
						</SessionBackgroundTasksOpener>
					)}
				/>
			}
		/>
	);
}

// The notify tip shows nothing until the user comes back from 30s away, so it loads with the first permission card.
const ToolApprovalNotifyTip = lazy(async () =>
	import("./tool-approval-notify-tip").then((module) => (
	{
		default: module.ToolApprovalNotifyTip,
	})),
);

// The Rewind picker loads on its first open (Esc Esc or /rewind) and stays mounted for its close animation.
const RewindPicker = lazy(async () =>
	import("./rewind-picker").then((module) => (
	{
		default: module.RewindPicker,
	})),
);
// The `/usage` card loads when a session first shows one.
const LiveSessionUsageCard = lazy(async () =>
	import("./session-usage-card").then((module) => (
	{
		default: module.LiveSessionUsageCard,
	})),
);
// The "Rewind to this message?" confirm loads when a rewind first needs it.
const RewindConfirm = lazy(async () =>
	import("./rewind-confirm").then((module) => (
	{
		default: module.RewindConfirm,
	})),
);

// The /output-style and /memory dialogs load on their first open.
const OutputStyleDialog = lazy(async () =>
	import("./output-style-dialog").then((module) => (
	{
		default: module.OutputStyleDialog,
	})),
);
const MemoryDialog = lazy(async () =>
	import("./memory-dialog").then((module) => (
	{
		default: module.MemoryDialog,
	})),
);

// The /advisor dialog loads on its first open.
const AdvisorDialog = lazy(async () =>
	import("./advisor-dialog").then((module) => (
	{
		default: module.AdvisorDialog,
	})),
);

/** Upstream's conversation-rewind failures (`kb`). */
const REWIND_NOT_POSSIBLE = "Can’t rewind to this message.";
const REWIND_CONVERSATION_AFTER_CODE_FAILED =
	"Restored the code, but couldn’t rewind the conversation. Try rewinding again.";

export function SessionPage({
	sessionId,
	routeId = sessionId,
	scrollKey,
	scrollRestoration,
	requestedPane,
	onRequestedPaneHandled,
}:
{
	sessionId: string;
	routeId?: string;
	scrollKey?: string;
	scrollRestoration?: MainScrollRestorationSnapshot | undefined;
} & RequestedPaneProps)
{
	// Plain `useQuery` (not suspense) so the app shell stays painted and this
	// page can show its own skeleton while the transcript payload loads.
	const detailQuery = useQuery(sessionDetailQueryOptions(sessionId));
	const transcriptQuery = useQuery(transcriptQueryOptions(sessionId));
	const subagentsQuery = useQuery(sessionSubagentsQueryOptions(sessionId));
	const herdrQuery = useQuery(herdrPanesQueryOptions);
	const locationScrollKey = useLocation(
		{
			select: (location) => sessionScrollKey(location, sessionId),
		},
	);
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

interface SessionViewProps extends RequestedPaneProps
{
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

/** The window's first record, by uuid where it has one, so a session switch reads as a new transcript. */
function firstRecordKey(transcript: TranscriptData): string | undefined
{
	const first = transcript.records[0];
	if (first === undefined) return undefined;
	const uuid = first["uuid"];
	return typeof uuid === "string" ? uuid : `#${transcript.startIndex}`;
}

/**
 * Whether this session was archived after the page saw it unarchived. Upstream's band slot only
 * animates bands that mount after first paint, so the archived note band-enters when the session is
 * archived while open, and stays put when the session was already archived on open.
 */
function useArchivedSinceOpen(sessionId: string, archived: boolean): boolean
{
	const [seen, setSeen] = useState(
		{
			sessionId,
			unarchived: !archived,
		},
	);
	if (seen.sessionId !== sessionId)
	{
		setSeen(
			{
				sessionId,
				unarchived: !archived,
			},
		);
		return false;
	}
	if (!archived && !seen.unarchived)
		setSeen(
			{
				sessionId,
				unarchived: true,
			},
		);
	return archived && seen.unarchived;
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
}: SessionViewProps)
{
	// The project path can fail to resolve from its lossy directory name (e.g. a
	// dotted folder), so the session's recorded cwd stands in for it.
	const sessionDirectory = data.projectPath ?? data.cwd;
	const archivedNoteEnters = useArchivedSinceOpen(sessionId, data.archived);
	const findQueryClient = useQueryClient();
	// In-app Find counts the whole session, so a new query pages in the history the transcript has not loaded.
	const loadRestForFind = useCallback(
		async () => fetchAllEarlierTranscript(findQueryClient, sessionId),
		[findQueryClient, sessionId],
	);
	const scrollAnchorRef = useRef<HTMLDivElement>(null);
	const locationHash = useLocation(
		{
			select: (location) => location.hash,
		},
	);
	// Viewed positions are stored in message units (see message-count.ts) so
	// they line up with messageCount and newMessageCount on every surface. The
	// transcript is only a window over the JSONL, so the messages the server
	// trimmed off the front still count towards the position.
	// Rows on an abandoned branch don't count, matching the chain-only session count.
	const hiddenUuids = useMemo(() => new Set(transcript.hiddenUuids), [transcript.hiddenUuids]);
	const currentMessageIndex = useMemo(
		() => transcript.precedingMessageCount + countMessageRecords(transcript.records, hiddenUuids) - 1,
		[transcript.precedingMessageCount, transcript.records, hiddenUuids],
	);
	// Grows only when the session appends; paging backwards through history
	// leaves it alone, so it stays a reliable "did new work land?" signal.
	const endIndex = transcriptEndIndex(transcript);
	const {visibilityRef} = useSessionViewedState(sessionId, currentMessageIndex);
	const sessionViewRef = useCallback(
		(element: HTMLDivElement | null) =>
		{
			scrollAnchorRef.current = element;
			visibilityRef(element);
		},
		[visibilityRef],
	);
	const detailUnseen = !data.viewedState.viewedAnywhere;
	useEffect(() =>
	{
		syncUnseenFromSummaries([
			{
				id: sessionId,
				unseen: detailUnseen,
			},
		]);
	}, [detailUnseen, sessionId]);
	const {settings, setSetting} = useSettings();
	// Keyed off the window's startIndex so every line carries its session-absolute
	// JSONL record index, which locates a row whose record was collapsed into a
	// neighbour and resolves links copied before anchors moved to message uuids.
	// The server computes the active chain over the whole file, so the page only
	// skips the records it served as hidden and never recomputes the chain.
	const chainProcessed = useMemo(
		() =>
			processTranscript(
				transcript.records,
				transcript.startIndex,
				{
					hidden: hiddenUuids,
					cuts: transcript.cuts,
				},
			),
		[transcript.records, transcript.startIndex, hiddenUuids, transcript.cuts],
	);
	const hasThinking = useMemo(() => sessionHasThinking(chainProcessed.lines), [chainProcessed.lines]);
	const sessionGoal = useMemo(() => activeGoal(transcript.goalRows), [transcript.goalRows]);
	const transcriptView = useTranscriptModeShortcut(
		sessionId,
		{
			hasThinking,
		},
	);
	const {mode: transcriptMode, flags: transcriptFlags} = transcriptView;
	// Verbose is the raw JSONL view: abandoned branches stay in, behind each cut's marker.
	const showAbandoned = transcriptMode === "verbose" && transcript.hiddenUuids.length > 0;
	const processed = useMemo(
		() => (showAbandoned ? processTranscript(transcript.records, transcript.startIndex) : chainProcessed),
		[showAbandoned, chainProcessed, transcript.records, transcript.startIndex],
	);
	// `uuidToLine` is the set of messages the window holds, which is how a jump
	// decides whether to scroll or to page history in first.
	// Workflow cards are an enhancement over the plain rows, so the transcript never waits on (or fails with)
	// them, and a session that never launched a workflow never fetches them.
	const hasWorkflowCall = useMemo(() => linesHaveWorkflowCall(processed.lines), [processed.lines]);
	const workflowRuns = useQuery(
		{
			...sessionWorkflowRunsQueryOptions(sessionId),
			enabled: hasWorkflowCall,
		},
	).data;
	// Records before the window that paging can still reach; false at the file's start or once the cursor is lost.
	const hasUnloadedHistory = useHasEarlierTranscript(sessionId, transcript);
	const requestMessageJump = usePendingMessageJump(sessionId, hasUnloadedHistory, processed.uuidToLine);
	const chapterEdits = useSessionChapters(sessionId);
	const firstEntryUuid = firstRecordKey(transcript);
	const outlineChapters = useMemo(
		() =>
			buildSessionChapters(
				{
					claudeChapters: transcript.chapters,
					store: chapterEdits,
					firstEntryUuid,
					sessionStartTitle: "Session start",
				},
			),
		[transcript.chapters, chapterEdits, firstEntryUuid],
	);
	useRegisterChangesPane(sessionId, sessionDirectory ?? undefined);
	// A whole-session inventory costs a full pass over the JSONL, so only an open
	// Files or Links pane asks for it; this read just shares whatever they fetched.
	const resources = useQuery(sessionResourcesQueryOptions(sessionId, false)).data;
	// Until that scan lands, the panes fall back to extraction over the loaded
	// window, whose counts are floors: every surface showing one also takes
	// `transcript.startIndex`, the records still on the server, and marks the
	// count `12+` rather than passing a partial tally off as the total.
	const windowFiles = useExtractedSessionFiles(processed.lines, data.homeRoot);
	const jumpTargetWindow = useMemo<JumpTargetWindow>(
		() => (
		{
			windowStartIndex: transcript.startIndex,
			requestMessageJump,
		}),
		[requestMessageJump, transcript.startIndex],
	);
	useRegisterFilesPane(
		{
			sessionId,
			cwd: sessionDirectory ?? undefined,
			windowFiles,
			windowStartIndex: transcript.startIndex,
			jumpTargetWindow,
		},
	);
	const sessionArtifacts = useSessionArtifacts(sessionId);
	const outputFiles = useMemo(
		() => extractOutputFiles(transcript.records, sessionDirectory ?? null),
		[transcript.records, sessionDirectory],
	);
	// Sent session mentions are looked up only once a prompt in view carries an `@[Title]`.
	const carriesSessionMention = useMemo(
		() => transcript.records.some(userTextHasSessionMention),
		[transcript.records],
	);
	const {data: sentSessionMentions} = useQuery(
		{
			...sessionMentionsQueryOptions(sessionId),
			enabled: carriesSessionMention,
		},
	);
	const mentionOutputs = useMemo(
		() =>
			mentionOutputFiles(
				transcript.records,
				sessionDirectory ?? null,
				homeOf(sessionDirectory ?? null),
				// The session ran on this app's machine; a /Users home means macOS.
				sessionDirectory?.startsWith("/Users/") === true,
			),
		[transcript.records, sessionDirectory],
	);
	useRegisterArtifactsPane(sessionArtifacts);
	useRegisterLinksPane(
		{
			sessionId,
			lines: processed.lines,
			windowStartIndex: transcript.startIndex,
			jumpTargetWindow,
		},
	);
	useIdlePrefetch(SESSION_PANE_CHUNKS);
	const {hookContexts, runningSubagents, pendingTools} = useClaudeEvents();
	const hookContext = hookContexts.get(sessionId);
	const transcriptActiveSubagents = useMemo(() => extractPendingSubagents(transcript.records), [transcript.records]);
	const activeSubagents = useMemo(() =>
	{
		const eventSubagents: ActiveSubagent[] = [...runningSubagents.values()]
			.filter((subagent) => subagent.sessionId === sessionId)
			.map((subagent) => (
			{
				key: getSubagentLifecycleKey(subagent.sessionId, subagent.agentId, subagent.agentType),
				...subagent,
			}));
		return eventSubagents.length > 0 ? eventSubagents : transcriptActiveSubagents;
	}, [sessionId, runningSubagents, transcriptActiveSubagents]);
	const [aiSummary, setAiSummary] = useState<string | null>(data.summary ?? null);
	const isActive = useIsSessionActive(sessionId);
	const [lastInterrupt, setLastInterrupt] = useState<
	{
		sessionId: string;
		at: number;
	} | null>(null);
	const notifications = useQuery(
		{
			...notificationsQueryOptions(),
			select: (data) => data.notifications,
		},
	).data;
	const sessionSummary = useCachedSessionSummary(sessionId);
	const sessionPermissionWait = sessionSummary?.awaitingPermission === true;
	const permissionWaitId = useMemo(
		() =>
			permissionWaitToolUseId(
				{
					sessionId,
					notifications: notifications ?? [],
					records: transcript.records,
					awaitingPermission: sessionPermissionWait,
				},
			),
		[sessionId, notifications, transcript.records, sessionPermissionWait],
	);
	// A prompt this tab answered is consumed at the click, as upstream's answered set hides it.
	const permissionWaitAnswered = useApprovalAnswered(sessionId, permissionWaitId);
	const awaitingPermission = permissionWaitId !== null && !permissionWaitAnswered;
	const sessionSummaryState = sessionSummary?.state ?? null;
	// A session this tab just answered is working again at the click, before the server's summary says so.
	const answeredHeld = useAnsweredSessionIds().has(sessionId);
	const displaySummaryState = answeredHeld && sessionSummaryState === "waiting" ? "working" : sessionSummaryState;
	const hookQuestion = useQuery(
		{
			...pendingQuestionQueryOptions(sessionId),
			// Only a waiting session can have one; SSE patches the cache either way.
			enabled: sessionSummaryState === "waiting",
			select: (data) => data.pendingQuestion,
		},
	).data;
	const hookPlan = useQuery(
		{
			...pendingPlanQueryOptions(sessionId),
			// Only a waiting session can have one; SSE patches the cache either way.
			enabled: sessionSummaryState === "waiting",
			select: (data) => data.pendingPlan,
		},
	).data;
	const pendingElicitations = useQuery(
		{
			...pendingElicitationsQueryOptions(sessionId),
			// Only a waiting session can have one; SSE patches the cache either way.
			enabled: sessionSummaryState === "waiting",
			select: (data) => data.pendingElicitations,
		},
	).data;
	// The CLI writes a pending ExitPlanMode to the JSONL only once answered, so its hook copy docks until then.
	const hookDockedPlan = useMemo(
		() =>
			dockedHookPlan(
				{
					hookPlan,
					state: sessionSummaryState,
					records: transcript.records,
				},
			),
		[hookPlan, sessionSummaryState, transcript.records],
	);
	// A plan this tab answered is consumed at the click: its card and every gate drop until the answer fails.
	const dockedPlanAnswered = useApprovalAnswered(sessionId, hookDockedPlan?.toolUseId ?? null);
	const dockedPlan = dockedPlanAnswered ? null : hookDockedPlan;
	useForgetAnsweredHookPlan(sessionId, hookPlan?.toolUseId ?? null);
	// Until the record lands on disk, the Plan pane shows the plan the dock is asking about.
	const planModel = useMemo(
		() => withPendingPlan(sessionPlanModel(processed.lines), hookDockedPlan),
		[processed.lines, hookDockedPlan],
	);
	const sessionHasPlan = hasSessionPlan(data.planFilename, planModel);
	const composerPlan = useMemo(
		() => (
		{
			hasPlan: sessionHasPlan,
			olderMessagesNotLoaded: hasUnloadedHistory,
		}),
		[sessionHasPlan, hasUnloadedHistory],
	);
	const turnTokens = useMemo(() => turnTokenUsage(transcript.records), [transcript.records]);
	const workingMarkerState = useWorkingMarkerState(
		{
			records: transcript.records,
			sessionState: displaySummaryState,
			isActive,
			pendingToolName: pendingTools.get(sessionId)?.toolName,
			interruptedAt: lastInterrupt?.sessionId === sessionId ? lastInterrupt.at : null,
			awaitingPermission: awaitingPermission && !answeredHeld,
		},
	);
	// The turn's in-flight call has its own running row in the transcript; upstream marks an Agent step too.
	const pendingCall = useMemo(() => findLastPendingToolUse(transcript.records), [transcript.records]);
	const waitingPlanId = inlinePlanToolUseId(sessionSummaryState, pendingCall);
	const inlinePlanAnswered = useApprovalAnswered(sessionId, waitingPlanId);
	const inlinePlanId = inlinePlanAnswered ? null : waitingPlanId;
	const inlinePlanCard = useMemo(() =>
	{
		if (inlinePlanId !== null)
			return {
				toolUseId: inlinePlanId,
				planText: planText(pendingCall?.input ?? {}),
			};
		if (dockedPlan === null) return null;
		return {
			toolUseId: dockedPlan.toolUseId,
			planText: dockedPlan.plan,
		};
	}, [inlinePlanId, pendingCall, dockedPlan]);
	const inFlightRow = workingMarkerState.status === "working" && pendingCall !== null;
	const backgroundTasks = useMemo(
		() =>
			extractBackgroundTasks(
				transcript.records,
				{
					sessionActive: sessionProcessLive(
						{
							hookActive: isActive,
							summaryState: sessionSummaryState,
						},
					),
					processStartedAt: sessionSummary?.processStartedAt ?? null,
					teammates: subagents,
					runningSubagents: activeSubagents,
					...(hookContext?.backgroundTasks === undefined
						? {}
						:
							{
								hookTasks: hookContext.backgroundTasks,
							}),
				},
			),
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
	const visibleBackgroundTasks = useVisibleBackgroundTasks(sessionId, backgroundTasks);
	const runningBackgroundLaunches = useMemo(
		() =>
			new Map(
				backgroundTasks.running.flatMap((task) =>
					task.toolUseId === null ? [] : [[task.toolUseId, task.id] as const],
				),
			),
		[backgroundTasks],
	);
	useRegisterSubagentPane(
		{
			sessionId,
			subagents,
			records: transcript.records,
		},
	);
	const statusline = useStatusline(sessionId);
	useRegisterSessionDetailsPane(statusline, data.messageCount);
	const composerServerState = useComposerServerState(sessionId);
	const commandBreakdown = useMemo(() => latestBreakdown(transcript.records), [transcript.records]);
	const
	{
		data: modBreakdown = null,
		isFetching: modBreakdownFetching,
		isError: modBreakdownFailed,
	} = useQuery(sessionContextBreakdownQueryOptions(sessionId));
	const contextBreakdown = preferNewerBreakdown(commandBreakdown, modBreakdown);
	// The CLI running the session, for the Context section's stale-engine notice: the live statusline's, else the transcript's.
	const recordVersion = useMemo(() => latestRecordVersion(transcript.records), [transcript.records]);
	const engineVersion = statusline?.version ?? recordVersion;
	// A statusline without `rate_limits` leaves the ring to the account's plan limits.
	const {data: accountUsage} = useQuery(usageQueryOptions);
	const composerChin = useMemo(
		() =>
			withComposerAccountLimits(
				resolveComposerState(
					{
						hookPermissionMode: hookContext?.permissionMode,
						jsonlPermissionMode: lastPermissionModeFromRecords(transcript.records),
						settingsDefaultMode: composerServerState?.settingsDefaultMode ?? null,
						statuslineModel: composerServerState?.statusline?.model?.display_name ?? null,
						statuslineModelId: composerServerState?.statusline?.model?.id ?? null,
						lastAssistantModel: lastAssistantModelFromRecords(transcript.records),
						lastAssistantUsage: lastAssistantUsageFromRecords(transcript.records),
						lastAssistantEffort: lastAssistantEffortFromRecords(transcript.records),
						...sessionComposerFastMode(transcript.records, composerServerState),
						settingsModel: composerServerState?.settingsModel ?? null,
						settingsModelManaged: composerServerState?.settingsModelManaged ?? false,
						settingsAvailableModels: composerServerState?.settingsAvailableModels ?? null,
						settingsEffortLevel: composerServerState?.settingsEffortLevel ?? null,
						statusline: composerServerState?.statusline ?? null,
						statuslineUpdatedAt: composerServerState?.statuslineUpdatedAt ?? null,
					},
				),
				accountUsage,
			),
		[hookContext?.permissionMode, transcript.records, composerServerState, accountUsage],
	);
	// Upstream's `/status`: a client-only user row and Session info card after the newest line, live on every render.
	const turnActive = workingMarkerState.status !== "idle";
	const statusCommand = useMemo(
		() => (
		{
			turnActive,
			show: (text: string) =>
			{
				appendClientRow(
					sessionId,
					{
						kind: "status",
						text,
						afterUuid: lastRecordUuid(transcript.records),
					},
				);
			},
		}),
		[turnActive, sessionId, transcript.records],
	);
	const liveStatusSources = useMemo(
		() => (
		{
			cliVersion: statusline?.version ?? null,
			modelId: composerChin.modelId,
			effort: composerChin.effort.id,
			fastMode: composerChin.fastMode,
			permissionMode: composerChin.mode?.id ?? null,
			outputStyle: statusline?.output_style?.name ?? null,
		}),
		[statusline, composerChin],
	);
	// Upstream's `/usage` and `/cost`: the same client-only rows with a Usage card; Settings › Usage mid-turn.
	const openSettings = useOpenSettings();
	const usageCommand = useMemo(
		() => (
		{
			turnActive,
			show: (text: string) =>
			{
				appendClientRow(
					sessionId,
					{
						kind: "usage",
						text,
						afterUuid: lastRecordUuid(transcript.records),
					},
				);
			},
			openSettings: () =>
			{
				openSettings("usage");
			},
		}),
		[turnActive, sessionId, transcript.records, openSettings],
	);
	const renderClientRowCard = useCallback(
		(row: ClientRow) =>
			row.kind === "status" ? (
				<LiveSessionStatusCard sessionId={sessionId} />
			) : (
				<Suspense fallback={null}>
					<LiveSessionUsageCard sessionId={sessionId} />
				</Suspense>
			),
		[sessionId],
	);
	// Upstream lets the user comment on the plan in plan mode or while a plan waits for approval.
	useRegisterPlanPane(
		data.planFilename,
		planModel,
		{
			sessionId,
			commentsEnabled:
				composerChin.mode?.id === "plan" || dockedPlan !== null || pendingCall?.name === "ExitPlanMode",
		},
	);
	// The CLI hides its own /fast for a third-party provider or CLAUDE_CODE_DISABLE_FAST_MODE; a policy block still lists it.
	const fastBlockCode = composerChin.fastModeBlocked?.code;
	const slashMenu = useSlashCommands(
		sessionDirectory ?? undefined,
		Boolean(sessionDirectory),
		true,
		{
			effortLevels: effortLevelsFor(composerChin.modelId),
			fastListed: fastBlockCode !== "not_first_party" && fastBlockCode !== "disabled_by_env",
		},
	);
	const {slashCommands} = slashMenu;
	const {data: promptHistory} = useQuery(
		{
			...promptHistoryQueryOptions(sessionId),
			enabled: Boolean(sessionDirectory),
		},
	);
	const sessionMentionProvider = useSessionMentionProvider(sessionId);

	const mentionProviders = useMemo(() => [sessionMentionProvider], [sessionMentionProvider]);
	const [generating, setGenerating] = useState(false);
	const summaryMutation = useRequestSummary(sessionId);
	const chromeHidden = settings.chromeHidden;
	const setChromeHidden = useCallback(
		(v: boolean) =>
		{
			setSetting("chromeHidden", v);
		},
		[setSetting],
	);
	const chromeShortcut = useShortcutKeys("expand_collapse_pane");
	const toggleChromeHidden = useCallback(() =>
	{
		setChromeHidden(!chromeHidden);
	}, [chromeHidden, setChromeHidden]);

	const answerRoute = sessionAnswerRoute(
		{
			sessionId,
			hookActive: isActive,
			summary: sessionSummary,
			herdr,
		},
	);
	const answerLiveness = sessionLiveness(
		{
			hookActive: isActive,
			summary: sessionSummary,
		},
	);
	const submitAnswer = useCallback(
		async ({toolUseId, questions, picks}: AnswerSubmission) =>
		{
			const {submitQuestionAnswer} = await import("../lib/question-answer-submit");
			await submitQuestionAnswer(
				answerRoute,
				{
					sessionId,
					toolUseId,
					questions,
					picks,
				},
			);
		},
		[answerRoute, sessionId],
	);
	const pendingQuestion = useMemo(() => findPendingAskUserQuestion(transcript.records), [transcript.records]);
	// Until the question's record is on disk its hook copy is drawn inline; the hook state lags the JSONL, so an answered record never brings it back.
	// The hook's question, until the transcript already holds its answer.
	const unansweredHookQuestion = useMemo(
		() => liveHookQuestion(hookQuestion, transcript.records),
		[hookQuestion, transcript.records],
	);
	const hookQuestionSent = useQuestionCardSent(hookQuestion?.toolUseId ?? "");
	const hookQuestionCardShown = useMemo(
		() =>
			isHookQuestionCardShown(
				{
					state: sessionSummaryState,
					hookQuestion,
					records: transcript.records,
					sent: hookQuestionSent,
				},
			),
		[sessionSummaryState, hookQuestion, transcript.records, hookQuestionSent],
	);
	// Upstream draws a pending question inline as its card; one in the transcript answers there while the session runs.
	const inlineQuestion = isActive ? pendingQuestion : null;
	const inlineQuestionSent = useQuestionCardSent(inlineQuestion?.toolUseId ?? "");
	// The transcript draws a pending question's card whatever the hook-active set says, so cardShown counts it until it is sent.
	const transcriptQuestionSent = useQuestionCardSent(pendingQuestion?.toolUseId ?? "");
	const transcriptQuestionCard = pendingQuestion !== null && !transcriptQuestionSent;
	// Upstream consumes the question at submit: its gates release while the pane still types the answer.
	const questionSent = (hookQuestionSent && unansweredHookQuestion !== null) || inlineQuestionSent;
	const chatStream = useChatStream();
	const toast = useToast();
	const forkSession = useSessionFork();
	const forkCwd = data.cwd ?? data.projectPath ?? null;
	const forkFromMessage =
		forkCwd === null
			? undefined
			: (target: {sessionId: string; atMessage: string}) =>
				{
					forkSession(
						{
							...target,
							cwd: forkCwd,
						},
					);
				};
	const refillRejectedPrompt = useCallback(
		(id: string, prompt: string) => refillRejectedSend(id, prompt, toast),
		[toast],
	);
	const promptBehavior = getSessionPromptBehavior(sessionId, isActive, herdr);
	const slashRemoteControl = useSlashRemoteControl(
		{
			sessionId,
			canToggle: promptBehavior.hasLivePane && herdr.writesEnabled,
			working: workingMarkerState.status !== "idle",
		},
	);
	const liveHerdrPrompt = useLiveHerdrPrompt(
		sessionId,
		endIndex,
		processed.lines,
		undefined,
		refillRejectedPrompt,
		promptBehavior.hasLivePane,
		herdr.panes
			.filter((pane) => pane.sessionId === sessionId)
			.map((pane) => `${pane.paneId}@${pane.revision}`)
			.join(","),
	);
	const herdrReconnecting = useHerdrReconnecting(liveHerdrPrompt.state.phase === "held");
	const {retryRejection, dismissRejection, retryFailedSend, discardFailedSend} = useSendRejectionActions(
		sessionId,
		liveHerdrPrompt.state.rejection,
		liveHerdrPrompt.clearRejection,
		liveHerdrPrompt,
	);
	const stopAvailable = canStopResponse(
		{
			hasLivePane: promptBehavior.hasLivePane,
			writesEnabled: herdr.writesEnabled,
			working: workingMarkerState.status !== "idle",
		},
	);
	const backgroundTaskStop = useBackgroundTaskStop(
		{
			sessionId,
			enabled: promptBehavior.hasLivePane && herdr.writesEnabled && !data.archived,
			running: backgroundTasks.running,
			toast,
		},
	);
	useRegisterBackgroundTasksPane(
		sessionId,
		visibleBackgroundTasks,
		subagents.length,
		workflowRuns,
		backgroundTaskStop,
	);
	const agentsKilledMarker = useMemo(() => latestAgentsKilledId(transcript.records), [transcript.records]);
	const nestedStop = useNestedStop(
		{
			sessionId,
			count: nestedStopCount(backgroundTasks.running),
			enabled: promptBehavior.hasLivePane && herdr.writesEnabled,
			killedMarker: agentsKilledMarker,
			toast,
		},
	);
	const bypassPermissionsAllowed = composerServerState?.settingsBypassPermissionsAllowed ?? false;
	const liveModes = useMemo(
		() => modeMenuItems(bypassPermissionsAllowed).map((item) => item.id),
		[bypassPermissionsAllowed],
	);
	const folderModes = useFolderModeMemory(sessionDirectory ?? undefined);
	const modeBadges = useModeBadges(sessionDirectory ?? undefined, folderModes.modes);
	const liveLaunch = useLiveLaunchOptions(
		{
			sessionId,
			currentMode: composerChin.mode?.id ?? "default",
			availableModes: liveModes,
			hookContext,
			toast,
			onModeFailed: folderModes.rollback,
		},
	);
	const liveLaunchAvailable = canApplyLive(
		{
			hasLivePane: promptBehavior.hasLivePane,
			writesEnabled: herdr.writesEnabled,
			working: workingMarkerState.status !== "idle",
		},
	);
	const onInterrupt = useCallback(
		(at: number) =>
		{
			setLastInterrupt(
				{
					sessionId,
					at,
				},
			);
		},
		[sessionId],
	);
	const onInterruptError = useCallback(
		(error: unknown) =>
		{
			toast(
				{
					kind: "error",
					message: "Couldn't stop the response",
					description: error instanceof Error ? error.message : String(error),
				},
			);
		},
		[toast],
	);
	// The CLI's open permission asks, oldest first: the head names the call the permission card describes.
	const permissionAsks = sessionSummary?.pendingPermissionAsks ?? EMPTY_PERMISSION_ASKS;
	const headToolAsk = useMemo(
		() =>
			permissionQueue(
				permissionAsks.filter((ask) => !OWN_CARD_ASK_TOOLS.has(ask.toolName)),
				transcript.records,
			).head ?? undefined,
		[permissionAsks, transcript.records],
	);
	const toolPermission = useMemo(
		() =>
			inlineQuestion === null
				? findPendingPermission(
						{
							sessionId,
							isActive,
							notifications: notifications ?? [],
							records: transcript.records,
							awaitingPermission: sessionPermissionWait,
							ask: headToolAsk,
						},
					)
				: null,
		[isActive, inlineQuestion, sessionId, notifications, transcript.records, sessionPermissionWait, headToolAsk],
	);
	// Upstream draws a verdict elicitation as a permission card; only the oldest one's dialog is on screen.
	const elicitationPermissions = useMemo(
		() => (inlineQuestion === null ? findPendingElicitationPermissions(pendingElicitations ?? []) : []),
		[inlineQuestion, pendingElicitations],
	);
	const headElicitation = elicitationPermissions[0]?.permission ?? null;
	// Upstream's queue (`mS`/`ES`): one head card is drawn; the rest wait behind it as "Also waiting" or dock ghosts.
	// An answered head keeps its place, hidden by its own card, until the signal that drew it clears.
	const approvalQueue = useMemo(
		() =>
			sessionApprovalQueue(
				{
					asks: permissionAsks,
					records: transcript.records,
					permissionKey: toolPermission === null ? null : permissionAnswerKey(toolPermission),
					elicitations: elicitationPermissions.map((entry) => (
					{
						key: permissionAnswerKey(entry.permission),
						serverName: entry.serverName,
						receivedAt: entry.receivedAt,
					})),
					planId: inlinePlanCard?.toolUseId ?? null,
					// A sent hook question keeps its place: its card has become the receipt until the record lands.
					hookQuestionId: hookQuestionCardShown ? (hookQuestion?.toolUseId ?? null) : null,
					transcriptQuestionId: transcriptQuestionCard ? pendingQuestion.toolUseId : null,
				},
			),
		[
			permissionAsks,
			transcript.records,
			toolPermission,
			elicitationPermissions,
			inlinePlanCard,
			hookQuestionCardShown,
			hookQuestion,
			transcriptQuestionCard,
			pendingQuestion,
		],
	);
	const headKind = approvalQueue.head?.kind ?? null;
	const queueDepth = approvalQueue.queueDepth;
	const headPlanCard = headKind === "plan" ? inlinePlanCard : null;
	const elicitationPermission = headKind === "elicitation" ? headElicitation : null;
	// A verdict elicitation answers through the CLI's elicitation dialog; Deny takes its Decline stop.
	const answersElicitation = elicitationPermission !== null;
	const sendPermissionDecision = useCallback(
		async (decision: PermissionDecision) =>
			answersElicitation
				? sendHerdrElicitationDecision(sessionId, decision)
				: sendHerdrPermissionDecision(sessionId, decision),
		[answersElicitation, sessionId],
	);
	const candidatePermission = headKind === "tool" ? toolPermission : elicitationPermission;
	// Keyed by its tool call, so a handoff between the signals that describe it neither remounts nor redraws it.
	const permissionKey = candidatePermission === null ? null : permissionAnswerKey(candidatePermission);
	// A card the server says isn't pending is stale: it drops and the lists that drew it refetch.
	const
	{
		dropped: permissionDropped,
		answer: answerPermission,
		answerWith: answerPermissionWith,
	} = usePermissionAnswer(
		{
			permissionId: permissionKey,
			send: sendPermissionDecision,
		},
	);
	const shownPermission = permissionDropped ? null : candidatePermission;
	// Upstream's arrival announcement for the shown card, read once per card by the status region beside the slot.
	const permissionArrivalText = useMemo(
		() => (shownPermission === null ? null : permissionAnnouncement(shownPermission)),
		[shownPermission],
	);
	const inlinePermissionRef = useRef<HTMLDivElement>(null);
	const permissionCanAnswer = promptBehavior.hasLivePane && herdr.writesEnabled;
	// The terminal's dialog stands in for upstream's ask flags; an elicitation's has no permission rows.
	const permissionDialog = usePermissionDialogShape(
		sessionId,
		permissionKey,
		shownPermission !== null && permissionCanAnswer && !answersElicitation,
	);
	// Upstream's "Allow and switch to Auto": offered from Manual or Accept edits once the terminal's dialog is read.
	const permissionMode = composerChin.mode?.id ?? "default";
	const permissionAutoOffered = autoSwitchOffered(
		{
			mode: permissionMode,
			availableModes: liveModes,
			canAnswer: permissionCanAnswer,
			readGated: false,
			elicitation: answersElicitation,
			dialog: permissionDialog,
		},
	);
	const sendAllowAuto = useCallback(
		async (presses: number | null) => sendHerdrPermissionAllowAuto(sessionId, presses),
		[sessionId],
	);
	const answerAllowOnce = useCallback(async () => sendPermissionDecision("allow"), [sendPermissionDecision]);
	const permissionAutoSwitch: SessionAutoSwitch =
	{
		offered: permissionAutoOffered,
		answerWith: answerPermissionWith,
		workspace: consentWorkspaceKey(sessionDirectory ?? undefined),
		mode: permissionMode,
		availableModes: liveModes,
		sendAllowAuto,
		answerAllow: answerAllowOnce,
		expectMode: liveLaunch.expectMode,
		toast,
	};
	// The gates (working line, Stop, composer) release at the click; the card hides itself and returns on a failure.
	const permissionAnswered = useApprovalAnswered(sessionId, permissionKey);
	const pendingPermission = permissionAnswered ? null : shownPermission;
	// The trailing approval slot's drawn card: the permission card, else the plan card, else the hook question card.
	const approvalSlotCard = sessionApprovalSlotCard(
		{
			permission:
				pendingPermission === null || permissionKey === null
					? null
					:
						{
							key: permissionKey,
							dialog: permissionDialog,
						},
			planId: headPlanCard?.toolUseId ?? null,
			questionId: headKind === "hook-question" && !hookQuestionSent ? (hookQuestion?.toolUseId ?? null) : null,
		},
	);
	// Upstream's cluster head (`Ms`): an MCP call's approval docks the whole cluster above the composer, latched per
	// head; an AskUserQuestion head that drew inline never moves down.
	const transcriptQuestionId = transcriptQuestionCard && headKind === "question" ? pendingQuestion.toolUseId : null;
	const hookQuestionHeadId = headKind === "hook-question" ? (hookQuestion?.toolUseId ?? null) : null;
	const approvalHeadId =
		(pendingPermission === null ? null : permissionKey) ??
		headPlanCard?.toolUseId ??
		hookQuestionHeadId ??
		transcriptQuestionId;
	const approvalDecision = useApprovalPresentation(
		approvalHeadId,
		headKind !== "question" && headKind !== "hook-question",
	);
	const [approvalDockSlot, setApprovalDockSlot] = useState<HTMLDivElement | null>(null);
	const approvalDock: ApprovalDock = useMemo(
		() => (
		{
			presentation: approvalDecision,
			dockSlot: approvalDockSlot,
			transcriptQuestionId,
		}),
		[approvalDecision, approvalDockSlot, transcriptQuestionId],
	);
	const approvalPresentation = approvalDecision === "dock" && approvalDockSlot !== null ? "dock" : "card";
	// Upstream's `RC($_(placement) ? id : undefined)`: while the cluster lists the queued requests, their lone
	// transcript rows give way to it.
	const queuedCallIds = useMemo(
		() =>
			placementDrawsQueue(
				approvalPlacement(
					{
						inlineApprovals: true,
						isReadOnly: data.archived,
						aboveTurnBox: approvalPresentation === "dock",
						clusterLive: approvalHeadId !== null,
					},
				),
			)
				? queuedRequestIds(approvalQueue)
				: EMPTY_QUEUED_IDS,
		[data.archived, approvalPresentation, approvalHeadId, approvalQueue],
	);
	// A form or url elicitation stays with the terminal dialog, but the waiting notice names its server.
	const elicitationNotice = useMemo(
		() => findElicitationWaitingNotice(pendingElicitations ?? []),
		[pendingElicitations],
	);
	// A url elicitation docks its own Decline / Open card while the live pane can be typed into.
	const urlElicitationCard = useMemo(
		() =>
			sessionSummaryState === "waiting" && promptBehavior.hasLivePane && herdr.writesEnabled
				? findUrlElicitationCard(pendingElicitations ?? [])
				: null,
		[sessionSummaryState, promptBehavior.hasLivePane, herdr.writesEnabled, pendingElicitations],
	);
	// The CLI's "Session paused" refusal dialog docks upstream's card while the live pane can be typed into.
	const refusalFallbackDialog = useRefusalFallbackDialog(
		sessionId,
		sessionSummaryState === "waiting" && promptBehavior.hasLivePane && herdr.writesEnabled
			? (sessionSummary?.dialogOpenAt ?? null)
			: null,
	);
	// A sent hook question's card stays as its receipt, but the turn no longer waits on it.
	const cardWaitsOnUser =
		pendingPermission !== null ||
		transcriptQuestionCard ||
		(hookQuestionCardShown && !hookQuestionSent) ||
		inlinePlanId !== null ||
		dockedPlan !== null ||
		urlElicitationCard !== null;
	const liveCardShown = cardWaitsOnUser || hookQuestionCardShown;
	// The working line's "Needs your input" replaces the dock's waiting notice, as upstream shows only the former.
	const workingLineWaits = workingLineWaitsOnUser(
		{
			awaitingPermission: awaitingPermission && !answeredHeld,
			sessionState: displaySummaryState,
			cardShown: liveCardShown,
		},
	);
	// Upstream's `hasLiveApproval`: a card this tab draws keeps the row in Needs input over a Mark as completed ack.
	useLiveApproval(sessionId, liveCardShown);
	const hookQuestionToolUseId = hookQuestion?.toolUseId;
	const answerHookQuestion = useCallback(
		async (answers: Array<QuestionAnswer | null>) =>
		{
			if (hookQuestionToolUseId !== undefined)
			{
				await sendHerdrQuestionAnswer(sessionId, hookQuestionToolUseId, answers);
			}
		},
		[sessionId, hookQuestionToolUseId],
	);
	const askUserQuestionCtx: AskUserQuestionContextValue = useMemo(
		() => (
		{
			sessionId,
			answerRoute,
			sessionLive: answerLiveness,
			submitAnswer,
		}),
		[sessionId, answerRoute, answerLiveness, submitAnswer],
	);
	const planApprovalCtx: PlanApprovalContextValue = useMemo(
		() => (
		{
			sessionId,
			answerRoute,
			loadDialog: async () => fetchHerdrPlanDialog(sessionId),
			decide: async (decision) => sendHerdrPlanDecision(sessionId, decision),
		}),
		[answerRoute, sessionId],
	);
	const composerGate = composerPendingGate(
		{
			hookQuestion: unansweredHookQuestion,
			transcriptQuestion: inlineQuestion !== null,
			awaitingPermission,
			questionSent,
		},
	);
	// The pane shows the dialog until the answer's result lands, so a prompt typed meanwhile is held mid-turn.
	const paneBusy = workingMarkerState.status !== "idle" || liveHerdrPrompt.state.isPending || questionSent;
	const dialogOpen = gateHoldsQueue(composerGate) || questionSent;
	const queueBusy = paneBusy || dialogOpen;
	const requestSendNowInterrupt = useCallback(async () =>
	{
		onInterrupt(Date.now());
		await sendHerdrInterrupt(sessionId, false).catch(onInterruptError);
	}, [onInterrupt, onInterruptError, sessionId]);
	// A queued message's Send now toasts upstream's promote failure instead of the stop error.
	const requestQueuedSendNowInterrupt = useCallback(async () =>
	{
		onInterrupt(Date.now());
		await sendHerdrInterrupt(sessionId, false);
	}, [onInterrupt, sessionId]);
	const toastQueuedSendNowFailed = useCallback(() =>
	{
		toast(
			{
				kind: "error",
				message: SEND_NOW_FAILED_MESSAGE,
			},
		);
	}, [toast]);
	const focusSessionComposer = useCallback(() =>
	{
		focusComposer(sessionId);
	}, [sessionId]);
	const composerQueue = useComposerQueue(
		{
			sessionId,
			busy: queueBusy,
			dialogOpen,
			deliver: liveHerdrPrompt.send,
			interrupt: requestQueuedSendNowInterrupt,
			onSendNowFailed: toastQueuedSendNowFailed,
		},
	);
	const {enqueue: enqueuePrompt, items: queuedPrompts, remove: removeQueuedPrompt} = composerQueue;
	// Upstream's parked lane: an idle send while the usage limit is spent is held and auto-sends after the reset.
	const parkedLane = useParkedPrompts(
		{
			sessionId,
			usage: accountUsage,
			busy: paneBusy,
			blocked: dialogOpen,
			archived: data.archived,
			interruptedAt: lastInterrupt?.sessionId === sessionId ? lastInterrupt.at : null,
			deliver: liveHerdrPrompt.send,
		},
	);
	const {park: parkPrompt, decision: parkedDecision} = parkedLane;
	// Upstream lists parked prompts in the transcript only on its environments branch; local has no environments.
	const parkedInTranscript = parkedListInTranscript(
		{
			environmentsOn: LOCAL_ENVIRONMENTS_ON,
			inTranscript: promptBehavior.usesHerdr,
		},
	);
	const parkedItems = useMemo(() => parkedPrompts(queuedPrompts), [queuedPrompts]);
	const heldNotice = useMemo<HeldNotice | undefined>(
		() =>
			parkedInTranscript && parkedItems.length > 0
				?
					{
						count: parkedItems.length,
						willAutoSend: parkedLane.willAutoSend,
						resetsAt: parkedLane.windowResetsAt,
						archived: data.archived,
						flushing: parkedLane.flushing,
						sendAnyway: parkedLane.sendAnyway,
					}
				: undefined,
		[
			data.archived,
			parkedInTranscript,
			parkedItems.length,
			parkedLane.flushing,
			parkedLane.sendAnyway,
			parkedLane.willAutoSend,
			parkedLane.windowResetsAt,
		],
	);
	const composerQueueView = useMemo(
		() => (
		{
			...composerQueue,
			parked:
			{
				willAutoSend: parkedLane.willAutoSend,
				resetsAt: parkedLane.windowResetsAt,
				archived: data.archived,
				flushing: parkedLane.flushing,
				sendAnyway: parkedLane.sendAnyway,
				listInTranscript: parkedInTranscript,
			},
		}),
		[
			composerQueue,
			data.archived,
			parkedInTranscript,
			parkedLane.flushing,
			parkedLane.sendAnyway,
			parkedLane.willAutoSend,
			parkedLane.windowResetsAt,
		],
	);
	const cancelHeldPrompt = useCallback(
		(item: QueuedPrompt) =>
		{
			if (takeBackSend(sessionId, item.text, toast)) removeQueuedPrompt(item.id);
		},
		[removeQueuedPrompt, sessionId, toast],
	);
	const stopResponse = useStopResponse(
		{
			sessionId,
			// Esc denies the docked permission prompt instead of stopping the turn.
			enabled: stopAvailable && pendingPermission === null,
			onInterrupt,
			onError: onInterruptError,
			onEscapeRecall: () => recallLastHeldSteer(sessionId, steeredPrompts(queuedPrompts), removeQueuedPrompt),
		},
	);
	const {send: composerSend} = composerSendPlan(
		composerGate,
		{
			busy: paneBusy,
			queued: queuedPrompts.length,
		},
	);
	// A pending question, permission or plan card would swallow a typed prompt.
	const promptCardPending =
		pendingPermission !== null ||
		inlineQuestion !== null ||
		hookQuestionCardShown ||
		inlinePlanId !== null ||
		dockedPlan !== null;
	const errorRecoveryAvailable = errorRecoveryAvailability(
		{
			hasLivePane: promptBehavior.hasLivePane,
			writesEnabled: herdr.writesEnabled,
			paneStatus: workingMarkerState.status,
			pendingCard: promptCardPending,
			isPending: liveHerdrPrompt.state.isPending,
			isLastEntry: lastEntryIsError(processed.lines),
		},
	);
	const {retryable: errorRetryable, idle: errorIdle} = errorRecoveryAvailable;
	// Rewinding drives the live CLI's selector, so it needs a writable pane on a session that isn't archived.
	const rewindAvailable = promptBehavior.hasLivePane && herdr.writesEnabled && !data.archived;
	// Upstream's picker gate (`E_`) refuses while working, with a send pending, or under a card.
	const cardHeld =
		pendingPermission !== null ||
		inlineQuestion !== null ||
		hookQuestionCardShown ||
		inlinePlanId !== null ||
		dockedPlan !== null;
	const rewindBusy = paneBusy || liveHerdrPrompt.state.isPending || cardHeld;
	const rewindPicker = useRewindPicker(
		{
			sessionId,
			available: rewindAvailable,
			busy: rewindBusy,
		},
	);
	const rewindTurnList = useMemo(
		() => rewindTurns(transcript.records, hiddenUuids),
		[transcript.records, hiddenUuids],
	);
	// Upstream's conversation rewind (`kb`): on success the composer holds the rewound prompt, focused.
	const runConversationRewind = useCallback(
		async (uuid: string, text: string, afterCode: boolean) =>
		{
			const failed = afterCode ? REWIND_CONVERSATION_AFTER_CODE_FAILED : REWIND_NOT_POSSIBLE;
			const stepsBack = rewindStepsBack(rewindTurnList, uuid);
			if (stepsBack === null)
			{
				toast(
					{
						kind: "error",
						message: failed,
					},
				);
				return;
			}
			try
			{
				await sendHerdrRewind(
					sessionId,
					{
						stepsBack,
						text,
					},
				);
				refillComposer(sessionId, text);
			}
			catch (error)
			{
				toast(
					{
						kind: "error",
						message: afterCode || !(error instanceof Error) ? failed : error.message,
					},
				);
			}
		},
		[rewindTurnList, sessionId, toast],
	);
	const rewindRequest = useRewindRequest(
		{
			sessionId,
			conversationAvailable: rewindAvailable,
			runConversationRewind,
		},
	);
	const {requestRewind} = rewindRequest;
	// A transcript row's Rewind to here: the prompt's text as the CLI's selector draws it.
	const rewindToMessage = useCallback(
		(uuid: string) =>
		{
			const turn = rewindTurnList.find((candidate) => candidate.uuid === uuid);
			if (turn === undefined)
				toast(
					{
						kind: "error",
						message: REWIND_NOT_POSSIBLE,
					},
				);
			else requestRewind(uuid, turn.text);
		},
		[requestRewind, rewindTurnList, toast],
	);
	const {requestOpen: requestRewindPicker} = rewindPicker;
	// A sent `/rewind`'s outcome: no writable live pane reads as upstream's offline computer.
	const composerRewindState: ComposerRewindState = data.archived
		? "unsupported"
		: !promptBehavior.hasLivePane || !herdr.writesEnabled
			? "offline"
			: rewindBusy
				? "busy"
				: "ready";
	const composerRewind = useMemo(
		() => (
		{
			state: composerRewindState,
			open: () =>
			{
				requestRewindPicker(
					{
						fromComposer: true,
					},
				);
			},
		}),
		[composerRewindState, requestRewindPicker],
	);
	// Upstream's `/advisor` dialog, per session (`eo`): only a writable live pane can take the command, and the
	// dialog closes when that goes away, as upstream's does when the gate drops.
	const advisorAvailable = !data.archived && promptBehavior.hasLivePane && herdr.writesEnabled;
	const [advisorDialogFor, setAdvisorDialogFor] = useState<string | null>(null);
	const composerAdvisor = useMemo(
		() =>
			advisorAvailable
				?
					{
						open: () =>
						{
							setAdvisorDialogFor(sessionId);
						},
					}
				: undefined,
		[advisorAvailable, sessionId],
	);
	const closeAdvisorDialog = useCallback(() =>
	{
		setAdvisorDialogFor(null);
	}, []);
	// Upstream's `/output-style` picker, per session, on the same live-pane gate: Apply types the command into the
	// CLI, which switches and saves the style. The styles include the session folder's `.claude/output-styles/`.
	const outputStyleCwd = data.cwd ?? data.projectPath ?? "";
	const outputStylesQuery = useQuery(
		{
			...sessionOutputStylesQueryOptions(outputStyleCwd),
			enabled: advisorAvailable,
		},
	);
	const outputStyles = useMemo(
		() => outputStyleItems(outputStylesQuery.data, sessionOutputStyle(statusline)),
		[outputStylesQuery.data, statusline],
	);
	const [outputStyleDialogFor, setOutputStyleDialogFor] = useState<string | null>(null);
	const composerOutputStyle = useMemo(
		() =>
			advisorAvailable
				?
					{
						hasSession: true as const,
						items: outputStyles,
						booting: outputStylesQuery.isPending,
						open: () =>
						{
							setOutputStyleDialogFor(sessionId);
						},
					}
				: undefined,
		[advisorAvailable, outputStyles, outputStylesQuery.isPending, sessionId],
	);
	const closeOutputStyleDialog = useCallback(() =>
	{
		setOutputStyleDialogFor(null);
	}, []);
	// Upstream's Memory dialog, per session: opening it refetches the context breakdown that lists the files.
	// `/memory` and the rail's Memory files row share this opener (upstream's `vv`).
	const [memoryDialogFor, setMemoryDialogFor] = useState<string | null>(null);
	const composerMemory = useMemo(
		() => (
		{
			open: () =>
			{
				setMemoryDialogFor(sessionId);
				void findQueryClient.invalidateQueries(
					{
						queryKey: sessionQueryKeys.contextBreakdown(sessionId),
					},
				);
			},
		}),
		[findQueryClient, sessionId],
	);
	const closeMemoryDialog = useCallback(() =>
	{
		setMemoryDialogFor(null);
	}, []);
	const memoryLoad = useMemoryDialogLoad(
		{
			open: memoryDialogFor === sessionId,
			hasBreakdown: contextBreakdown !== null,
			failed: modBreakdownFailed && commandBreakdown === null,
			turnActive: workingMarkerState.status !== "idle",
		},
	);
	const openContextCard = useCallback(() =>
	{
		requestRailContextCard(sessionId);
	}, [sessionId]);
	const rewindAvailableFromComposer = useMemo(
		() =>
			rewindAvailable
				? () =>
					{
						requestRewindPicker(
							{
								fromComposer: true,
							},
						);
					}
				: undefined,
		[rewindAvailable, requestRewindPicker],
	);
	// The cold-resume notice's inputs: the idle start, busy/held state and the Compact / New session actions.
	const navigate = useNavigate();
	const openCustomize = useOpenCustomize();
	// Upstream's `/skills`: Customize › Skills › Yours in the Settings dialog.
	const openSkills = useCallback(() =>
	{
		openCustomize("skills");
	}, [openCustomize]);
	// Upstream's non-dialog `/mcp`: Customize › Connectors.
	const openConnectors = useCallback(() =>
	{
		void navigate(
			{
				to: "/customize/connectors",
			},
		);
	}, [navigate]);
	const coldResumeLastRecordMs = useMemo(() => newestRecordMs(transcript.records), [transcript.records]);
	const coldResumeRunning =
		paneBusy || dialogOpen || sessionSummaryState === "working" || sessionSummaryState === "waiting";
	const coldResumeHeld = queuedPrompts.length > 0 || liveHerdrPrompt.state.phase === "held";
	const canTypeCompact = promptBehavior.hasLivePane && herdr.writesEnabled;
	const sendCompactPrompt = liveHerdrPrompt.send;
	const typeCompact = useCallback(async () =>
	{
		const result = await sendCompactPrompt("/compact");
		if (result === "not-ready") enqueuePrompt("/compact");
	}, [sendCompactPrompt, enqueuePrompt]);
	const coldResumeCompact = useMemo(
		() =>
			canTypeCompact
				? () =>
					{
						void typeCompact();
					}
				: undefined,
		[canTypeCompact, typeCompact],
	);
	// The stale-session compact line (upstream `nke` via host `wke`): it yields to the cold-resume card (`LMe`).
	const [coldResumeHolds, setColdResumeHolds] = useState(false);
	// Like upstream's effect outside the experiment, the clock stays off where the line could never show.
	const staleCompactIdle = useStaleCompactIdle(
		{
			anchorMs: canTypeCompact && !data.archived ? coldResumeLastRecordMs : null,
			responding: coldResumeRunning,
			hidden: chromeHidden,
		},
	);
	const staleCompactEligible =
		canTypeCompact &&
		!coldResumeRunning &&
		!coldResumeHeld &&
		!data.archived &&
		!chromeHidden &&
		!coldResumeHolds &&
		staleCompactSlot(
			{
				lastEntryIsAssistant: lastEntryIsAssistantReply(processed.lines),
			},
		);
	const staleCompactAdvisory =
		staleCompactIdle === null || staleCompactIdle.anchor !== coldResumeLastRecordMs
			? null
			: decideStaleCompact(
					{
						nowMs: staleCompactIdle.anchor + staleCompactIdle.ageMs,
						anchorMs: staleCompactIdle.anchor,
						contextTokens: composerChin.usage?.contextTokens ?? null,
						contextWindow: composerChin.usage?.contextWindowSize ?? null,
						floor: STALE_COMPACT_FLOOR,
						eligible: staleCompactEligible,
					},
				);
	// Upstream's compacting episode `K`: the band it started stays mounted while the compact runs.
	const [staleCompactEpisode, setStaleCompactEpisode] = useState<StaleCompactAdvisory | null>(null);
	const staleCompactShown = staleCompactEpisode ?? staleCompactAdvisory;
	const staleCompactRef = useRef(staleCompactShown);
	staleCompactRef.current = staleCompactShown;
	const staleCompactEpisodeRef = useRef(staleCompactEpisode);
	staleCompactEpisodeRef.current = staleCompactEpisode;
	const compactStaleSession = useCallback(() =>
	{
		const advisory = staleCompactRef.current;
		if (staleCompactEpisodeRef.current !== null || advisory === null) return;
		staleCompactEpisodeRef.current = advisory;
		setStaleCompactEpisode(advisory);
		void typeCompact().finally(() =>
		{
			setStaleCompactEpisode((current) => (current === advisory ? null : current));
		});
	}, [typeCompact]);
	const staleCompact = useMemo<StaleCompactBandProps | undefined>(
		() =>
			staleCompactShown === null
				? undefined
				:
					{
						ageMinutes: staleCompactShown.ageMinutes,
						contextTokens: staleCompactShown.contextTokens,
						tokensInLine: staleCompactShown.tokensInLine,
						compacting: staleCompactEpisode !== null,
						onCompact: compactStaleSession,
						focusComposer: focusSessionComposer,
					},
		[staleCompactShown, staleCompactEpisode, compactStaleSession, focusSessionComposer],
	);
	// The rail Context card's Compact session (upstream `oo`): herdr's gate stands in for upstream's `reach`.
	const compactSendPending = liveHerdrPrompt.state.isPending;
	const compactSendPendingRef = useRef(compactSendPending);
	compactSendPendingRef.current = compactSendPending;
	// Upstream `Da`: the retry toasts belong to this session and close when it changes or the page unmounts.
	const [compactToastScope, setCompactToastScope] = useState<AbortController | null>(null);
	useEffect(() =>
	{
		const scope = new AbortController();
		setCompactToastScope(scope);
		return () =>
		{
			scope.abort();
		};
	}, [sessionId]);
	const compactToastSignal = compactToastScope?.signal;
	const compactDeps = useMemo<CompactDeps>(
		() => (
		{
			send: sendCompactPrompt,
			enqueue: enqueuePrompt,
			toast,
			// Upstream `xS`, read at click time: a prompt of ours in flight or held for a pane.
			isBusy: () => compactSendPendingRef.current,
			...(compactToastSignal !== undefined &&
			{
				signal: compactToastSignal,
			}),
		}),
		[sendCompactPrompt, enqueuePrompt, toast, compactToastSignal],
	);
	const compactFromRail = useCallback(() =>
	{
		// Upstream `Dx`: a send already in flight makes the click a no-op.
		if (compactSendPendingRef.current) return;
		void sendCompact(compactDeps);
	}, [compactDeps]);
	const railContextPct = railContextPercent(
		composerChin.usage,
		contextBreakdown === null ? null : resolveStaleEngine(contextBreakdown, engineVersion).breakdown,
	);
	const compactReach = canTypeCompact ? (herdrReconnecting ? "detached" : "live") : "dormant";
	const compactResponding = workingMarkerState.status !== "idle" || compactSendPending || promptCardPending;
	const compactInFlight = staleCompactEpisode !== null;
	// Memoised so the composer chin's usage context keeps its identity between renders.
	const railCompact = useMemo(
		() =>
			compactActionState(
				{
					contextPct: railContextPct,
					hasHandler: true,
					reach: compactReach,
					responding: compactResponding,
					compacting: compactInFlight,
				},
			),
		[railContextPct, compactReach, compactResponding, compactInFlight],
	);
	// Read from the rail's cache only: the popover's MCP rows just borrow the connector names, so it never fetches.
	const {data: mcpServerList} = useQuery(
		{
			...customizeMcpServersQueryOptions,
			enabled: false,
		},
	);
	const usageContext = useMemo<UsageRingContext>(
		() => (
		{
			breakdown: contextBreakdown,
			engineVersion,
			breakdownFetching: modBreakdownFetching,
			working: workingMarkerState.status !== "idle",
			homeRoot: data.homeRoot,
			mcpServers: sessionConnectors(mcpServerList ?? [], sessionDirectory),
			compact:
			{
				state: railCompact,
				onCompact: compactFromRail,
			},
		}),
		[
			contextBreakdown,
			engineVersion,
			modBreakdownFetching,
			workingMarkerState.status,
			data.homeRoot,
			mcpServerList,
			sessionDirectory,
			railCompact,
			compactFromRail,
		],
	);
	// Upstream's refusal band shows only for fallbacks that arrive live: the records the page opened with
	// are history (upstream's restored, dismissed fallback).
	const [refusalLiveSince, setRefusalLiveSince] = useState(
		{
			sessionId,
			index: endIndex,
		},
	);
	if (refusalLiveSince.sessionId !== sessionId)
		setRefusalLiveSince(
			{
				sessionId,
				index: endIndex,
			},
		);
	const refusalLiveSinceIndex = refusalLiveSince.sessionId === sessionId ? refusalLiveSince.index : endIndex;
	const refusalFallback = useMemo(
		() => activeRefusalFallback(transcript.records, transcript.startIndex, refusalLiveSinceIndex, hiddenUuids),
		[transcript.records, transcript.startIndex, refusalLiveSinceIndex, hiddenUuids],
	);
	// Upstream's band "Rewind and retry" (`Mx`): only while the live CLI can rewind to the refused prompt.
	const refusalEditRetry = useRefusalEditRetry(
		{
			sessionId,
			refusedUuid: refusalFallback?.refusedUserMessageUuid ?? null,
			available: rewindAvailable && !rewindBusy,
			turns: rewindTurnList,
		},
	);
	// Upstream's hard-block host (cf6ae6197 `Fc`): every local session is the viewer's own.
	const latestBlock = useMemo(
		() =>
			HARD_BLOCK_CARDS
				? latestHardBlock(
						transcript.records,
						{
							turnInFlight: paneBusy,
							hidden: hiddenUuids,
						},
					)
				: null,
		[transcript.records, paneBusy, hiddenUuids],
	);
	const hardBlockEditRetry = useHardBlockEditRetry(
		{
			sessionId,
			available: rewindAvailable,
			busy: rewindBusy,
			block: latestBlock,
			turns: rewindTurnList,
			runConversationRewind,
		},
	);
	const hardBlockHost = useMemo<HardBlockHost | null>(
		() =>
			HARD_BLOCK_CARDS
				?
					{
						latest: latestBlock,
						blockAt: (uuid) => hardBlockAt(transcript.records, uuid, hiddenUuids),
						held: cardHeld,
						onEditRetry: hardBlockEditRetry.onEditRetry,
						editRetryBusyFor: hardBlockEditRetry.busyFor,
					}
				: null,
		[latestBlock, transcript.records, hiddenUuids, cardHeld, hardBlockEditRetry],
	);
	const refusalNewSession = useMemo(
		() =>
			sessionDirectory
				? (model: string) =>
					{
						void startSessionOnModel(
							sessionDirectory,
							model,
							{
								launch: launchHerdrSession,
								toast,
								open: (id) =>
								{
									void navigate(
										{
											to: "/session/$id",
											params:
											{
												id,
											},
										},
									);
								},
							},
						);
					}
				: undefined,
		[sessionDirectory, toast, navigate],
	);
	// Upstream c01e7498d `gh()`: the model-switched cards' host; only the live fallback gets an action.
	const refusalFallbackHost = useMemo<RefusalFallbackHost>(
		() => (
		{
			sessionId,
			live: refusalFallback,
			held: cardHeld,
			onNewSession: refusalNewSession,
			onEditRetry: refusalEditRetry,
		}),
		[sessionId, refusalFallback, cardHeld, refusalNewSession, refusalEditRetry],
	);
	const sessionProjectId = data.projectId;
	const coldResumeNewSession = useCallback(() =>
	{
		requestHomeLaunchFolder(sessionProjectId);
		void navigate(
			{
				to: "/",
			},
		).then(requestHomeComposerFocus);
	}, [navigate, sessionProjectId]);
	const sendErrorRecoveryPrompt = liveHerdrPrompt.send;
	const currentModelId = composerChin.modelId;
	const {settingsDefault, availableModels} = composerChin;
	const errorModelMenu = useMemo(
		() =>
			settingsModelMenu(
				{
					settingsDefault,
					availableModels,
				},
			),
		[settingsDefault, availableModels],
	);
	const errorRecovery = useMemo(
		() =>
			errorRecoveryHandlers(
				{
					retryable: errorRetryable,
					idle: errorIdle,
				},
				sendErrorRecoveryPrompt,
				enqueuePrompt,
				{
					...errorModelMenu,
					current: currentModelId,
					switchTo: async (model) =>
						switchModelForRetry(
							sessionId,
							model,
							{
								send: sendHerdrLiveOption,
								toast,
							},
						),
				},
				// A click is an explicit open, like the composer's /rewind, so a draft doesn't block it.
				rewindAvailableFromComposer,
				compactDeps,
				{
					verdict: parkedDecision,
					toast,
				},
			),
		[
			errorRetryable,
			errorIdle,
			sendErrorRecoveryPrompt,
			enqueuePrompt,
			currentModelId,
			errorModelMenu,
			sessionId,
			toast,
			rewindAvailableFromComposer,
			compactDeps,
			parkedDecision,
		],
	);
	const autoResumeAnnouncement = useLimitAutoResume(
		{
			sessionId,
			lines: processed.lines,
			retryable: errorRetryable,
			send: sendErrorRecoveryPrompt,
			composerText: () => getComposerText(sessionId),
			parked: parkedDecision,
		},
	);
	const sendLivePrompt = useCallback(
		async (prompt: string) =>
		{
			// Upstream parks only a plain send with no turn running (not a steer or an answer).
			if ((composerSend.kind === "send" || composerSend.kind === "queue") && !queueBusy && parkPrompt(prompt))
				return;
			switch (composerSend.kind)
			{
				case "dismiss-question-then-queue":
					// Upstream: a message sent under a question answers it as skipped, then goes in right away;
					// the queue types it mid-turn as soon as the hooks show the dialog closed.
					enqueuePrompt(
						prompt,
						{
							midTurn: true,
						},
					);
					try
					{
						await sendHerdrQuestionAnswer(sessionId, composerSend.toolUseId, composerSend.answers);
					}
					catch (error)
					{
						toast(
							{
								kind: "error",
								message: "Couldn't skip the question",
								description: error instanceof Error ? error.message : String(error),
							},
						);
					}
					return;
				case "steer":
					// Upstream's Enter while working: typed into the pane mid-turn, read at Claude's next step.
					enqueuePrompt(
						prompt,
						{
							midTurn: true,
						},
					);
					return;
				case "queue":
					// Enter while the pane shows a dialog, or behind earlier queued prompts, waits for the next idle.
					enqueuePrompt(prompt);
					return;
				case "send":
					if ((await liveHerdrPrompt.send(prompt)) === "not-ready") enqueuePrompt(prompt);
					return;
				default:
					assertNever(composerSend);
			}
		},
		[composerSend, enqueuePrompt, liveHerdrPrompt, parkPrompt, queueBusy, sessionId, toast],
	);
	const sendSetupCommand = useCallback(
		(prompt: string) =>
		{
			void sendLivePrompt(prompt);
		},
		[sendLivePrompt],
	);
	// Upstream's bash mode, where the terminal is the runner: `!<command>` typed into the live pane like a prompt.
	const runShellCommand = useMemo(
		() =>
			promptBehavior.usesHerdr
				? async (command: string) =>
						runShellCommandInPane(
							sessionId,
							command,
							{
								toast,
							},
						)
				: undefined,
		[promptBehavior.usesHerdr, sessionId, toast],
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
					void launchPromptFork(
						launch,
						sessionId,
						{
							launch: launchHerdrSession,
							onLaunched: setPendingFork,
							toast,
							now: Date.now,
						},
					),
			},
		);
	// Upstream's turn Undo sends its prompt like the composer does; read through a ref so the
	// context value stays put across renders.
	const submitComposerRef = useRef(submitComposer);
	useEffect(() =>
	{
		submitComposerRef.current = submitComposer;
	});
	const turnUndoSend = useMemo(
		() =>
			promptBehavior.usesHerdr
				? (text: string) =>
					{
						submitComposerRef.current("send", text, {});
					}
				: null,
		[promptBehavior.usesHerdr],
	);
	const applicationSettings = useQuery(applicationSettingsQueryOptions).data;
	const shellsEnabled = applicationSettings?.shellPaneEnabled ?? false;
	const {mutateAsync: saveApplicationSettings} = useSaveApplicationSettings();
	const enableTerminalWrites = useMemo(() =>
	{
		if (!promptBehavior.hasLivePane || herdr.writesEnabled || applicationSettings === undefined) return null;
		return async () =>
		{
			await saveApplicationSettings(
				{
					...applicationSettings,
					terminalWritesEnabled: true,
				},
			);
		};
	}, [promptBehavior.hasLivePane, herdr.writesEnabled, applicationSettings, saveApplicationSettings]);
	const startHerdrTerminal = useStartHerdrTerminal();
	const terminalDirectory = data.cwd ?? data.projectPath;
	const openTerminalHere = useMemo(
		() =>
			herdr.writesEnabled && terminalDirectory !== null
				? async () => startHerdrTerminal(terminalDirectory)
				: undefined,
		[herdr.writesEnabled, terminalDirectory, startHerdrTerminal],
	);
	useRegisterTerminalPane(
		sessionId,
		{
			livePane: promptBehavior.hasLivePane,
			interactive: promptBehavior.hasLivePane && herdr.writesEnabled,
			shells: shellsEnabled,
		},
		openTerminalHere,
	);
	const prevSessionIdRef = useRef(sessionId);

	useEffect(() =>
	{
		if (prevSessionIdRef.current !== sessionId)
		{
			prevSessionIdRef.current = sessionId;
			chatStream.reset();
		}
	}, [sessionId, chatStream]);

	// Hide the streamed reply once the JSONL has caught up. Otherwise the
	// stream bubble (kept around by isComplete) and the new transcript line
	// from SSE both render the same text — visible as a duplicate message.
	const completionRecordCountRef = useRef<number | null>(null);
	useEffect(() =>
	{
		if (chatStream.state.isStreaming)
		{
			completionRecordCountRef.current = null;
			return;
		}
		if (!chatStream.state.isComplete) return;
		if (completionRecordCountRef.current === null)
		{
			completionRecordCountRef.current = endIndex;
			return;
		}
		if (endIndex > completionRecordCountRef.current)
		{
			completionRecordCountRef.current = null;
			chatStream.reset();
		}
	}, [chatStream, chatStream.state.isStreaming, chatStream.state.isComplete, endIndex]);

	useEffect(() =>
	{
		setAiSummary(data.summary ?? null);
	}, [sessionId, data.summary]);

	const sessionCommands = createSessionCommands(sessionId, sessionDirectory);

	async function handleGenerateSummary()
	{
		setGenerating(true);
		try
		{
			const result = await summaryMutation.mutateAsync();
			if (result.summary)
			{
				setAiSummary(result.summary);
			}
		}
		finally
		{
			setGenerating(false);
		}
	}

	// Upstream nests the working line under the last reply; anything drawn after the transcript keeps it below that instead.
	const workingLineFollowsTranscript =
		pendingPermission !== null ||
		inlinePlanId !== null ||
		hookQuestionCardShown ||
		chatStream.state.isStreaming ||
		chatStream.state.isComplete ||
		liveHerdrPrompt.state.phase === "sending" ||
		liveHerdrPrompt.state.phase === "held" ||
		liveHerdrPrompt.state.phase === "sent" ||
		(promptBehavior.usesHerdr && steeredPrompts(queuedPrompts).length > 0);
	// Upstream `Xd`: the session's turn-mark store. Rows hold the mark through it, and hand the line their running
	// words when the line takes it. The in-flight call also quiets the line directly, so a server render agrees.
	const turnMarkStore = useTurnMarkStore(sessionId);
	const markHeld = useSyncExternalStore(turnMarkStore.subscribeMark, turnMarkStore.held, () => false);
	const markWords = useSyncExternalStore(
		turnMarkStore.subscribeMark,
		turnMarkStore.markWords,
		turnMarkStore.markWords,
	);
	const permissionWaits = useSyncExternalStore(turnMarkStore.subscribeMark, turnMarkStore.waits, turnMarkStore.waits);
	// Upstream `Qd`: the store hears when the session starts and stops waiting on a permission.
	useEffect(() =>
	{
		turnMarkStore.noteWaiting(awaitingPermission);
	}, [turnMarkStore, awaitingPermission]);
	useEffect(
		() => () =>
		{
			turnMarkStore.forgetSession();
		},
		[turnMarkStore],
	);
	const workingLineQuiet = tailMarkerQuiet(workingMarkerState, inFlightRow || markHeld);
	const workingToolLabel = useMemo((): WorkingLineToolLabel | null =>
	{
		if (markWords.words === undefined || workingMarkerState.status !== "working") return null;
		return {
			words: markWords.words,
			unspoken: markWords.unspoken,
			since: toolLabelSince(
				{
					callStartedAt: markWords.call?.startedAt ?? null,
					turnStartedAt: workingMarkerState.turnStartedAt,
					waits: permissionWaits,
				},
			),
		};
	}, [markWords, workingMarkerState, permissionWaits]);
	const toolLabelEndedAt = markWords.callWordsEndedAt ?? null;
	const runningTaskCount = backgroundTasks.running.length;
	// Upstream's "sending" phase lasts until the prompt reaches the transcript, or a sent answer's result lands.
	const promptSending =
		liveHerdrPrompt.state.phase === "sending" || liveHerdrPrompt.state.phase === "sent" || questionSent;
	// Upstream's `isResponding` gate on the line under a live card: blocked in the page that watched the turn, else none.
	const respondingHere = useRespondingHere(
		sessionId,
		{
			status: workingMarkerState.status,
			sessionState: displaySummaryState,
			sending: promptSending,
		},
	);
	const underCard = workingLineUnderCard(
		{
			cardShown: cardWaitsOnUser,
			respondingHere,
		},
	);
	const lineWaits = workingLineWaits || underCard === "blocked";
	const workingLine = useCallback(
		(inline: boolean, bare = false) => (
			<WorkingMarker
				state={workingMarkerState}
				quiet={workingLineQuiet}
				waitingOnUser={lineWaits}
				runningTasks={runningTaskCount}
				inline={inline}
				bare={bare}
				sending={promptSending}
				tokens={turnTokens.tokens}
				tokenFirstAt={turnTokens.firstAt}
				sessionKey={sessionId}
				toolLabel={workingToolLabel}
				toolLabelEndedAt={toolLabelEndedAt}
			/>
		),
		[
			workingMarkerState,
			workingLineQuiet,
			lineWaits,
			runningTaskCount,
			promptSending,
			turnTokens,
			sessionId,
			workingToolLabel,
			toolLabelEndedAt,
		],
	);
	// Upstream's live todo plan box (`ri` → `FS`, task path): the session's checklist in the transcript tail while
	// the turn works on it, or while calls it launched still run after it ends.
	const turnResponding = workingMarkerState.status !== "idle";
	const planState = useMemo(
		() => turnPlanState(transcript.records, planModel.todos, new Set(runningBackgroundLaunches.keys())),
		[transcript.records, planModel.todos, runningBackgroundLaunches],
	);
	const planBox = turnPlanBox(planState, turnResponding);
	const planHolds = planHoldsLoader(planBox);
	const shownPlan = usePlanExitHold(planBox?.todos ?? null, planBox?.working === true);
	// Upstream `pf`: while the docked permission card or the plan box holds the tail of a responding turn, the marked
	// row is carried below it. A turn parked on the card is not responding, so its row stays above the card.
	const cardHoldsTail = cardHoldsTranscriptTail(
		{
			cardShown: pendingPermission !== null,
			status: workingMarkerState.status,
		},
	);
	const markedRow = markedRowBelowTailSlot(
		{
			cardHoldsTail,
			planHoldsLoader: planHolds,
			heldRedialReported: false,
		},
	);
	// Upstream `busyLineBelowTailSlot`: the line moves into the tail chrome's grid below the card or plan box.
	// The blocked line under a live card sits in that grid too, after the card, wherever the card is drawn.
	const lineBelowTailSlot = planHolds || (workingLineFollowsTranscript && cardHoldsTail) || underCard === "blocked";
	const lineAfterTranscript = workingLineFollowsTranscript || planHolds || underCard === "blocked";
	// Upstream's fresh tab draws no line at all under a live card.
	const lineShown = underCard !== "none";
	// Upstream `aDe`'s `yieldFor`: the line below the tail slot takes the mark when no row is carried there.
	const lineTakesMark = lineBelowTailSlot && turnResponding && markedRow === false;
	const lineYieldId = useId();
	useEffect(
		() => (lineTakesMark ? turnMarkStore.yieldFor(lineYieldId) : undefined),
		[turnMarkStore, lineYieldId, lineTakesMark],
	);
	const transcriptTail = useMemo(
		() => (lineAfterTranscript || !lineShown ? null : workingLine(true)),
		[lineAfterTranscript, lineShown, workingLine],
	);
	const [tailActions] = useState(createTailActionsOutlet);
	// An inline card in the trailing slot: the working line moves into the tail chrome below it.
	const cardsShown =
		approvalPresentation === "card" &&
		((shownPermission !== null && permissionKey !== null) ||
			headPlanCard !== null ||
			(headKind === "hook-question" && hookQuestion !== null && hookQuestion !== undefined));
	// Upstream's tail chrome (`si`): the outlet and a quiet working line share one grid cell below the card or plan box.
	const tailChrome = lineAfterTranscript ? (
		lineBelowTailSlot ? (
			<div
				className={`grid grid-cols-[minmax(0,1fr)] gap-y-[var(--chat-turn-gap,15px)] [&>*]:min-w-0 [&>:empty]:invisible [&>:empty]:[grid-area:1/1] [&>[data-quiet]]:[grid-area:1/1] [&>[data-turn-mark-outlet]]:[grid-area:1/1]${planHolds ? " [&>[data-turn-working=true]:not(.invisible)]:[grid-area:1/1] [&:has(>[data-turn-working=true]:not(.invisible))>[data-turn-mark-outlet]]:invisible" : ""}`}
			>
				{markedRow !== false && <TurnMarkOutlet className="empty:hidden" underPlan={markedRow === "plan"} />}
				{lineShown && workingLine(false, true)}
			</div>
		) : cardsShown && lineShown ? (
			workingLine(false)
		) : undefined
	) : undefined;
	// Upstream's cluster column (`flex w-full flex-col gap-[var(--chat-turn-gap)]`); with no chrome below, the cards
	// end on the 16px the transcript list ends with.
	const clusterClass = `flex w-full flex-col gap-[var(--chat-turn-gap)]${cardsShown && tailChrome === undefined ? " pb-4" : ""}`;

	return (
		<SessionTurnProvider send={turnUndoSend} responding={workingMarkerState.status !== "idle"}>
			<TerminalWritesTipProvider enableWrites={enableTerminalWrites}>
				<ApprovalDockContext.Provider value={approvalDock}>
					<SessionMentionsProvider mentions={sentSessionMentions?.mentions}>
						<TurnMarkOutletProvider sessionId={sessionId} store={turnMarkStore}>
							<div
								className="h-full min-h-0"
								data-perf-session={sessionId}
								data-perf-session-route={routeId === sessionId ? undefined : routeId}
								style={transcriptWidthStyle(settings.transcriptWidth)}
							>
								<span role="status" className="sr-only">
									{autoResumeAnnouncement}
								</span>
								<TileHost
									sessionId={sessionId}
									onExpandWithoutPane={toggleChromeHidden}
									requestedPane={requestedPane}
									onRequestedPaneHandled={onRequestedPaneHandled}
								>
									<PlanAutoOpen
										sessionId={sessionId}
										firstRecordUuid={firstRecordKey(transcript)}
										liveCount={endIndex}
										hasTodos={planModel.todos.length > 0}
									/>
									<TerminalPaneShortcut
										available={promptBehavior.hasLivePane || shellsEnabled}
										shells={shellsEnabled}
									/>
									<FilesPaneShortcut />
									<ChangesPaneShortcut />
									<PalettePaneCommandsPublisher
										sessionId={sessionId}
										terminalAvailable={promptBehavior.hasLivePane || shellsEnabled}
										shells={shellsEnabled}
									/>
									{rewindPicker.used && (
										<Suspense fallback={null}>
											<RewindPicker
												open={rewindPicker.open}
												turns={rewindTurnList}
												onClose={rewindPicker.close}
												onSelect={requestRewind}
											/>
										</Suspense>
									)}
									{advisorAvailable && advisorDialogFor === sessionId && (
										<Suspense fallback={null}>
											<AdvisorDialog
												key={sessionId}
												current={sessionAdvisorModel(
													transcript.records,
													{
														advisorModel: composerServerState?.settingsAdvisorModel,
													},
												)}
												onClose={closeAdvisorDialog}
												onApply={(option) =>
												{
													closeAdvisorDialog();
													submitComposer("send", `/advisor ${option}`, {});
												}}
											/>
										</Suspense>
									)}
									{advisorAvailable &&
										outputStyleDialogFor === sessionId &&
										outputStyles !== undefined && (
											<Suspense fallback={null}>
												<OutputStyleDialog
													key={sessionId}
													items={outputStyles}
													onClose={closeOutputStyleDialog}
													onApply={(name) =>
													{
														submitComposer("send", `/output-style ${name}`, {});
													}}
												/>
											</Suspense>
										)}
									{memoryDialogFor === sessionId && (
										<Suspense fallback={null}>
											<MemoryDialog
												key={sessionId}
												sessionId={sessionId}
												cwd={data.cwd ?? data.projectPath ?? undefined}
												home={data.homeRoot}
												memoryFiles={contextBreakdown?.memoryFiles}
												load={memoryLoad}
												onClose={closeMemoryDialog}
											/>
										</Suspense>
									)}
									{rewindRequest.rewindConfirm !== null && (
										<Suspense fallback={null}>
											<RewindConfirm
												key={rewindRequest.rewindConfirm.token}
												text={rewindRequest.rewindConfirm.text}
												preview={rewindRequest.rewindConfirm.preview}
												conversation={rewindAvailable}
												onClose={rewindRequest.closeRewindConfirm}
												onConfirm={rewindRequest.confirmRewind}
											/>
										</Suspense>
									)}
									<RailTileFrame
										railInputs={
										{
											sessionId,
											homeRoot: data.homeRoot,
											cwd: sessionDirectory,
											gitBranch: data.gitBranch,
											model: composerChin.model,
											herdrPane: herdr.panes.find((pane) => pane.sessionId === sessionId) ?? null,
											live: sessionProcessLive(
												{
													hookActive: isActive,
													summaryState: sessionSummaryState,
												},
											),
											working: workingMarkerState.status !== "idle",
											canToggleRemoteControl: promptBehavior.hasLivePane && herdr.writesEnabled,
											usage: composerChin.usage,
											breakdown: contextBreakdown,
											engineVersion,
											openMemoryDialog: composerMemory.open,
											compact:
											{
												state: railCompact,
												onCompact: compactFromRail,
											},
											artifacts: sessionArtifacts,
											outputFiles,
											backgroundTasks: visibleBackgroundTasks,
											taskStop: backgroundTaskStop,
											pr: data.pr ?? null,
											prStatus: data.prStatus ?? null,
											goal: sessionGoal,
										}}
										runningBackgroundLaunches={runningBackgroundLaunches}
										sessionId={sessionId}
										anchorRef={sessionViewRef}
										visitKey={initialScrollKey}
										restoredScrollY={restoredScrollPosition?.scrollY}
										outline={(scrollRef) => (
											<SessionOutline
												sessionId={sessionId}
												chapters={outlineChapters}
												scrollRef={scrollRef}
												scrollKey={initialScrollKey}
												requestMessageJump={requestMessageJump}
												windowStartIndex={transcript.startIndex}
											/>
										)}
										header={
											<>
												{/* Sticky header: titlebar + hook context */}
												{!chromeHidden && (
													<div
														data-transcript-sticky-header
														className={SESSION_STICKY_HEADER_CLASS}
													>
														{/* Upstream `xk`: under the wide title row the titlebar lifts over every top tile. */}
														<LiftedHeader rowClassName={SESSION_LIFTED_HEADER_CLASS}>
															<SessionTitlebar
																sessionId={sessionId}
																data={data}
																isActive={isActive}
																local={
																{
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
																railToggleFoldable
																titlePending={sessionTitlePending(data, isActive)}
																paneToggles={
																	<SessionPaneControls
																		railAvailable
																		facts={
																		{
																			artifactCount: sessionArtifacts.length,
																			hasPlan: sessionHasPlan,
																			hasUnloadedHistory,
																			backgroundTasks: backgroundTasksFacts(
																				backgroundTasks,
																				subagents.length,
																			),
																			subagentCount: subagents.length,
																		}}
																		onExpandChat={() =>
																		{
																			setChromeHidden(true);
																		}}
																	/>
																}
															/>
														</LiftedHeader>
														<SessionAiTitleLine title={data.title} aiTitle={data.aiTitle} />

														{hookContext && (
															<SessionHookContext
																context={hookContext}
																verbose={transcriptMode === "verbose"}
															/>
														)}
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
																onClick={() =>
																{
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
												<div data-session-footer className={SESSION_FOOTER_CLASS}>
													<div className={!chromeHidden && sessionDirectory ? "pt-2" : ""}>
														<ComposerNoticeProvider>
															<SessionDock
																anchorRef={scrollAnchorRef}
																// A docked card is already on screen: the plain scroll-to-bottom pill shows.
																needsInput={
																	approvalPresentation === "card" &&
																	(pendingQuestion !== null ||
																		pendingPermission !== null ||
																		dockedPlan !== null ||
																		(sessionSummaryState === "waiting" &&
																			unansweredHookQuestion !== undefined &&
																			unansweredHookQuestion !== null))
																}
															>
																{!chromeHidden &&
																	sessionDirectory &&
																	(data.pr !== undefined ||
																		data.prStatus !== undefined) && (
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
																{showsWaitingForInputNotice(
																	{
																		state: sessionSummaryState,
																		hasDockedCard:
																			inlineQuestion !== null ||
																			pendingPermission !== null ||
																			dockedPlan !== null ||
																			urlElicitationCard !== null ||
																			refusalFallbackDialog !== null,
																		workingLineWaits,
																	},
																) &&
																	!unansweredHookQuestion && (
																		<WaitingForInputNotice {...elicitationNotice} />
																	)}
																{/* A url elicitation answers through the CLI's terminal dialog: Decline, or Open on the CLI's machine */}
																{urlElicitationCard !== null && (
																	<UrlElicitationDock
																		key={urlElicitationCard.key}
																		sessionId={sessionId}
																		card={urlElicitationCard}
																	/>
																)}
																{/* The CLI's refusal-fallback dialog: Edit prompt and retry, or Switch, answered in the terminal */}
																{refusalFallbackDialog !== null && (
																	<RefusalFallbackDock
																		sessionId={sessionId}
																		dialog={refusalFallbackDialog}
																	/>
																)}
																{/* Upstream docks a rejected send's session-error card above the composer */}
																{liveHerdrPrompt.state.rejection !== null && (
																	<DeferredSendRejectedCard
																		rejection={liveHerdrPrompt.state.rejection}
																		onRetry={retryRejection}
																		onDismiss={dismissRejection}
																	/>
																)}
																{/* Upstream's approval dock slot: the approval cluster moves here on a short viewport */}
																<div
																	ref={setApprovalDockSlot}
																	data-approval-dock=""
																	className="contents"
																/>
																{/* Upstream sets the usage chip between the docked card and the composer */}
																{!chromeHidden && sessionDirectory && (
																	<UsagePaceBanner held={heldNotice} />
																)}
																{!chromeHidden && sessionDirectory && (
																	<WorkflowSizeWarningNotice
																		runs={workflowRuns}
																		refusalShown={
																			!data.archived && refusalFallback !== null
																		}
																	/>
																)}
																{/* Upstream's band needs a local session; locally, a live pane this app can type into */}
																{!chromeHidden &&
																	sessionDirectory &&
																	promptBehavior.hasLivePane &&
																	herdr.writesEnabled && (
																		<SessionAutoModeSetupBand
																			cwd={sessionDirectory}
																			paneWritable
																			effectiveMode={composerChin.mode?.id}
																			sendLive={sendSetupCommand}
																		/>
																	)}
																{!chromeHidden && sessionDirectory && (
																	<NotifyMePrompt sessionId={sessionId} />
																)}
																{!chromeHidden &&
																	sessionDirectory &&
																	!data.archived && (
																		<ColdResumeNotice
																			sessionId={sessionId}
																			lastRecordMs={coldResumeLastRecordMs}
																			running={coldResumeRunning}
																			heldInput={coldResumeHeld}
																			contextTokens={
																				composerChin.usage?.contextTokens ??
																				null
																			}
																			fiveHourPct={
																				composerChin.usage?.fiveHour
																					?.usedPercentage ?? null
																			}
																			anyWindowSpent={usageWindowSpent(
																				composerChin.usage,
																				Date.now(),
																			)}
																			onStay={focusSessionComposer}
																			onCompact={coldResumeCompact}
																			onNewSession={coldResumeNewSession}
																			onHoldChange={setColdResumeHolds}
																		/>
																	)}
																{/* Upstream's notice region: registered bands (usage → `limit`) stacked in NOTICE_ORDER */}
																{!chromeHidden && sessionDirectory && (
																	<ComposerNoticeRegion />
																)}
																{/* Upstream's composer stand-in: an archived session shows the Unarchive note in the editor's slot, the dock's last child */}
																{!chromeHidden && sessionDirectory && data.archived && (
																	<div
																		className="contents"
																		data-band-enter={
																			archivedNoteEnters ? "" : undefined
																		}
																	>
																		<ArchivedComposerNote sessionId={sessionId} />
																	</div>
																)}
																{!chromeHidden &&
																	sessionDirectory &&
																	!data.archived && (
																		<SessionBackgroundTasksOpener
																			sessionId={sessionId}
																			running={COMPOSER_RUNNING_LAUNCHES}
																		>
																			<Composer
																				variant="session"
																				draftKey={sessionId}
																				dropScope="chat-panel"
																				onSend={(
																					prompt,
																					launchOptions,
																					routing,
																				) =>
																				{
																					// Upstream's `Me("btw")`: a CLI-routed twin pick skips the side chat.
																					if (
																						routing?.cliCommandForced !==
																							true &&
																						handleBtwPrompt(
																							prompt,
																							{
																								sessionId,
																								messageCount:
																									data.messageCount,
																								toast,
																							},
																						)
																					)
																					{
																						return;
																					}
																					submitComposer(
																						"send",
																						prompt,
																						launchOptions,
																					);
																				}}
																				onFork={(prompt, launchOptions) =>
																					submitComposer(
																						"fork",
																						prompt,
																						launchOptions,
																					)
																				}
																				statusCommand={statusCommand}
																				usageCommand={usageCommand}
																				signInRunsInTerminal={signInRunsInTerminal(
																					{
																						pane: paneState,
																						writesEnabled:
																							herdr.writesEnabled,
																					},
																				)}
																				forkLabel={forkSubmitLabel(
																					{
																						pane: paneState,
																						writesEnabled:
																							herdr.writesEnabled,
																					},
																				)}
																				onCancel={() =>
																				{
																					void chatStream.cancel();
																				}}
																				isStreaming={
																					!promptBehavior.usesHerdr &&
																					chatStream.state.isStreaming
																				}
																				onStop={
																					stopAvailable
																						? stopResponse
																						: undefined
																				}
																				nestedStop={nestedStop}
																				stopAskedAt={
																					lastInterrupt?.sessionId ===
																					sessionId
																						? lastInterrupt.at
																						: null
																				}
																				disabled={
																					promptBehavior.disabled ||
																					(!promptBehavior.usesHerdr &&
																						liveHerdrPrompt.state.isPending)
																				}
																				queue={
																					promptBehavior.usesHerdr
																						? composerQueueView
																						: undefined
																				}
																				onQueueForLater={
																					promptBehavior.usesHerdr
																						? enqueuePrompt
																						: undefined
																				}
																				deliveryHint={
																					promptBehavior.deliveryHint
																				}
																				chin={composerChin}
																				usageContext={usageContext}
																				{...slashMenu}
																				slashRemoteControl={slashRemoteControl}
																				bypassPermissionsAllowed={
																					bypassPermissionsAllowed
																				}
																				modeBadges={modeBadges}
																				permissionCwd={sessionDirectory}
																				onPermissionModePick={
																					folderModes.remember
																				}
																				live={
																					liveLaunchAvailable
																						? liveLaunch
																						: undefined
																				}
																				mentionSessionId={sessionId}
																				mentionCwd={sessionDirectory}
																				mentionProviders={mentionProviders}
																				mentionOutputs={mentionOutputs}
																				promptHistory={promptHistory?.prompts}
																				bashHistory={
																					promptHistory?.bashCommands
																				}
																				rewind={composerRewind}
																				advisor={composerAdvisor}
																				outputStyle={composerOutputStyle}
																				memory={composerMemory}
																				openConnectors={openConnectors}
																				openSkills={openSkills}
																				plan={composerPlan}
																				onOpenContext={openContextCard}
																				onShellCommand={runShellCommand}
																			/>
																		</SessionBackgroundTasksOpener>
																	)}
															</SessionDock>
														</ComposerNoticeProvider>
													</div>
												</div>
											</>
										}
									>
										<LegacyMessageLinkNotice hash={locationHash} />

										{/* The transcript spans the page padding; the chat column's own gutters inset it, as on upstream */}
										{/* Upstream's transcript root: transcript-scoped turn (20px, 16px compact) and item (10.5px) gaps */}
										<div className="flex-1 epitaxy-transcript-typography [--chat-turn-gap:calc(var(--spacing)*5)]! compact:[--chat-turn-gap:calc(var(--spacing)*4)]!">
											{/* Chat messages */}
											<AskUserQuestionProvider value={askUserQuestionCtx}>
												<TranscriptHistoryLoader
													sessionId={sessionId}
													startIndex={transcript.startIndex}
													chainVersion={transcript.chainVersion}
												/>
												<SessionFileRefs
													sessionId={sessionId}
													cwd={sessionDirectory ?? undefined}
													sessionFiles={resources?.files ?? windowFiles}
												>
													<SessionSubagentOpener sessionId={sessionId}>
														<SessionBackgroundTasksOpener
															sessionId={sessionId}
															running={runningBackgroundLaunches}
														>
															<TranscriptActionsProvider
																sessionId={sessionId}
																lines={processed.lines}
																fork={forkFromMessage}
																rewind={rewindToMessage}
																working={paneBusy}
																archived={data.archived}
															>
																<HardBlockHostContext.Provider value={hardBlockHost}>
																	<RefusalFallbackHostContext.Provider
																		value={refusalFallbackHost}
																	>
																		<TranscriptTailContext.Provider
																			value={transcriptTail}
																		>
																			<TailActionsOutletContext.Provider
																				value={tailActions}
																			>
																				<FindLoadRestContext.Provider
																					value={loadRestForFind}
																				>
																					<LiveStatusSourcesProvider
																						value={liveStatusSources}
																					>
																						<TranscriptRevisionContext.Provider
																							value={
																								transcript.records
																									.length
																							}
																						>
																							<PeerSendersProvider
																								sessionId={sessionId}
																								lines={processed.lines}
																							>
																								<SessionChat
																									sessionId={
																										sessionId
																									}
																									lines={
																										processed.lines
																									}
																									measurementSource={
																										transcript.records
																									}
																									measurementLayout={JSON.stringify(
																										[
																											settings.showDebug,
																											settings.interfaceFont,
																											settings.transcriptTextSize,
																											settings.codeFont,
																											settings.transcriptWidth,
																										],
																									)}
																									toolResultMap={
																										processed.toolResultMap
																									}
																									rewindCuts={
																										chainProcessed.cutsByReplacement
																									}
																									rewoundUuids={
																										hiddenUuids
																									}
																									allowedImageRoots={
																										data.imageRoots
																									}
																									subagents={
																										subagents
																									}
																									{...(workflowRuns ===
																									undefined
																										? null
																										:
																											{
																												workflowRuns,
																											})}
																									showThinking={
																										transcriptFlags.showThinking
																									}
																									showTools={
																										transcriptFlags.showTools
																									}
																									showPassedHooks={
																										transcriptFlags.showPassedHooks
																									}
																									showHookWarnings={
																										transcriptFlags.showHookWarnings
																									}
																									showHookErrors={
																										transcriptFlags.showHookErrors
																									}
																									showSystemBanners={
																										transcriptFlags.showSystemBanners
																									}
																									showCompactSummaries={
																										transcriptFlags.showCompactSummaries
																									}
																									showTranscriptOnly={
																										transcriptFlags.showTranscriptOnly
																									}
																									transcriptMode={
																										transcriptMode
																									}
																									sessionLive={sessionProcessLive(
																										{
																											hookActive:
																												isActive,
																											summaryState:
																												sessionSummaryState,
																										},
																									)}
																									turnInProgress={
																										workingMarkerState.status !==
																										"idle"
																									}
																									archived={
																										data.archived
																									}
																									permissionWaitToolUseId={
																										permissionWaitId
																									}
																									queuedCallIds={
																										queuedCallIds
																									}
																									onSendNow={
																										requestSendNowInterrupt
																									}
																									onFocusComposer={
																										focusSessionComposer
																									}
																									sideChatAvailable={
																										true
																									}
																									initialScrollKey={
																										initialScrollKey
																									}
																									scrollContentRef={
																										scrollAnchorRef
																									}
																									shouldScrollToEnd={
																										restoredScrollPosition ===
																											undefined &&
																										locationHash ===
																											""
																									}
																									summary={aiSummary}
																									{...(slashCommands ===
																									undefined
																										? {}
																										:
																											{
																												slashCommands,
																											})}
																									{...(errorRecovery !==
																										undefined &&
																									{
																										errorRecovery,
																									})}
																									staleCompact={
																										staleCompact
																									}
																									renderClientRowCard={
																										renderClientRowCard
																									}
																								/>
																							</PeerSendersProvider>
																						</TranscriptRevisionContext.Provider>
																					</LiveStatusSourcesProvider>
																				</FindLoadRestContext.Provider>
																			</TailActionsOutletContext.Provider>
																		</TranscriptTailContext.Provider>
																	</RefusalFallbackHostContext.Provider>
																</HardBlockHostContext.Provider>
															</TranscriptActionsProvider>
														</SessionBackgroundTasksOpener>
													</SessionSubagentOpener>
												</SessionFileRefs>
											</AskUserQuestionProvider>

											{(chatStream.state.isStreaming || chatStream.state.isComplete) && (
												<StreamingMessage
													text={chatStream.state.text}
													isComplete={chatStream.state.isComplete}
													error={chatStream.state.error}
													forkedSessionId={chatStream.state.forkedSessionId}
													sentPrompt={chatStream.state.sentPrompt}
												/>
											)}

											{liveHerdrPrompt.failedSends.map((failed) => (
												<FailedUserRow
													key={failed.id}
													prompt={failed.prompt}
													sentAt={formatSendTime(failed.sentAt)}
													onRetry={() =>
													{
														retryFailedSend(failed.id);
													}}
													onDiscard={() =>
													{
														discardFailedSend(failed.id);
													}}
												/>
											))}
											{liveHerdrPrompt.state.phase === "sending" && (
												<SendingUserRow prompt={liveHerdrPrompt.state.prompt} />
											)}
											{liveHerdrPrompt.state.phase === "held" && (
												<HeldUserRow
													prompt={liveHerdrPrompt.state.prompt}
													reconnecting={herdrReconnecting}
													onWithdraw={liveHerdrPrompt.withdraw}
												/>
											)}
											{liveHerdrPrompt.state.phase === "sent" && (
												<OptimisticWaitingTurn
													prompt={liveHerdrPrompt.state.prompt}
													onSendNow={
														workingMarkerState.status === "idle"
															? undefined
															: requestSendNowInterrupt
													}
													onFocusComposer={focusSessionComposer}
												/>
											)}

											{promptBehavior.usesHerdr && (
												<HeldSteerTurns
													items={steeredPrompts(queuedPrompts)}
													head={
														liveHerdrPrompt.state.prompt === "" &&
														!(
															sessionProcessLive(
																{
																	hookActive: isActive,
																	summaryState: sessionSummaryState,
																},
															) &&
															processed.lines.some(
																(line) => line.type === "queued-prompt",
															)
														)
													}
													onSendNow={composerQueue.sendNow}
													onCancel={cancelHeldPrompt}
													onFocusComposer={focusSessionComposer}
												/>
											)}
											{parkedInTranscript && (
												<ParkedWaitingTurns items={parkedItems} onCancel={cancelHeldPrompt} />
											)}

											{/* Upstream's after-rows block (`w8`): the sticky approval cards, the tail turn and the tail chrome */}
											<TranscriptAfterRows
												cards={
													// Upstream's approval slot: a keyboard-answered card hands focus to the next card or the composer
													<ApprovalClusterHost>
														{/* Upstream's cluster column; the list's own bottom padding stands in for its turn-gap top */}
														<div
															className={
																approvalPresentation === "dock"
																	? "contents"
																	: clusterClass
															}
														>
															{/* Upstream's arrival region: in the cluster column so it moves with the cards into the dock */}
															<ApprovalArrivalRegion
																toolId={
																	permissionArrivalText === null
																		? null
																		: permissionKey
																}
																text={permissionArrivalText}
																cardRef={inlinePermissionRef}
															/>
															<ApprovalSlot sessionId={sessionId} {...approvalSlotCard}>
																{/* Upstream draws every pending approval inline; a permission prompt is not on disk, so it follows the transcript */}
																{shownPermission && permissionKey !== null && (
																	<div
																		ref={inlinePermissionRef}
																		data-inline-permission=""
																		// Upstream portals the card into its `transcript-tail-slot`, which in-app Find skips.
																		data-find-omitted=""
																		// Upstream's tail chrome pads the 15px under a card that holds the tail.
																		// The trailing slot carries the chat column; the cluster spaces the cards.
																		className={
																			approvalPresentation === "dock"
																				? "contents"
																				: "empty:hidden"
																		}
																	>
																		<SessionBackgroundTasksOpener
																			sessionId={sessionId}
																			running={runningBackgroundLaunches}
																		>
																			<DeferredSessionPermissionCard
																				key={permissionKey}
																				enterKey={permissionKey}
																				sessionId={sessionId}
																				answerKey={permissionKey}
																				title={shownPermission.title}
																				detail={shownPermission.detail}
																				detailLang={
																					shownPermission.detailLang ?? null
																				}
																				clampTitle={
																					shownPermission.clampTitle === true
																				}
																				detailIsPath={
																					shownPermission.detailIsPath ===
																					true
																				}
																				detailNote={
																					shownPermission.detailNote ?? null
																				}
																				description={
																					shownPermission.description ?? null
																				}
																				tokenWarning={
																					shownPermission.tokenWarning ===
																					true
																				}
																				detailFirst={
																					shownPermission.detailFirst === true
																				}
																				rows={shownPermission.rows ?? null}
																				rowsTrail={
																					shownPermission.rowsTrail === true
																				}
																				rowsGate={
																					shownPermission.rowsGate === true
																				}
																				rowsGateStrict={
																					shownPermission.rowsGateStrict ===
																					true
																				}
																				detailReadGate={
																					shownPermission.detailReadGate ??
																					null
																				}
																				perUseOnly={
																					shownPermission.perUseOnly === true
																				}
																				clickOnly={
																					shownPermission.clickOnly === true
																				}
																				fileChange={
																					shownPermission.fileChange ?? null
																				}
																				folds={shownPermission.folds ?? null}
																				toolName={
																					shownPermission.toolName ?? null
																				}
																				toolInput={
																					shownPermission.toolInput ?? null
																				}
																				canAnswer={permissionCanAnswer}
																				// The CLI can refuse an early Enter, so the elicitation's ElicitationResult clears its card.
																				hideOnDecision={!answersElicitation}
																				persistentAllow={
																					shownPermission.persistentAllow ??
																					null
																				}
																				persistentAllowSaves={
																					shownPermission.persistentAllowSaves ??
																					null
																				}
																				dialog={permissionDialog}
																				autoSwitch={permissionAutoSwitch}
																				onDecision={answerPermission}
																				presentation={approvalPresentation}
																				queueDepth={queueDepth}
																				footer={
																					<Suspense fallback={null}>
																						<ToolApprovalNotifyTip
																							sessionId={sessionId}
																						/>
																					</Suspense>
																				}
																			/>
																		</SessionBackgroundTasksOpener>
																	</div>
																)}
																{/* Upstream draws a pending plan's approval as its own card in the sticky trailing slot, whether
										    the record is on disk or only the hooks carry it yet */}
																{headPlanCard !== null && (
																	<DeferredInlinePlanApproval
																		key={headPlanCard.toolUseId}
																		toolUseId={headPlanCard.toolUseId}
																		planText={headPlanCard.planText}
																		plan={planApprovalCtx}
																		presentation={approvalPresentation}
																		queueDepth={queueDepth}
																	/>
																)}
																{/* Until the question's record is on disk, its hook copy is drawn inline at the transcript's end */}
																{headKind === "hook-question" && hookQuestion && (
																	<div
																		data-hook-question=""
																		className={
																			approvalPresentation === "dock"
																				? "contents"
																				: undefined
																		}
																	>
																		<QuestionCard
																			key={hookQuestion.toolUseId}
																			draftKey={hookQuestion.toolUseId}
																			questions={hookQuestion.questions}
																			onSubmit={
																				answerRoute === "live-pane"
																					? answerHookQuestion
																					: undefined
																			}
																			sessionId={sessionId}
																			presentation={approvalPresentation}
																			queueDepth={queueDepth}
																		/>
																	</div>
																)}
															</ApprovalSlot>
															{/* Upstream's "Also waiting": the requests queued behind the inline head card */}
															{approvalPresentation === "card" &&
																approvalQueue.queued.length > 0 && (
																	<div data-find-omitted="">
																		<ApprovalAlsoWaiting
																			queued={approvalQueue.queued}
																			presentation={approvalPresentation}
																		/>
																	</div>
																)}
															{/* Docked, the transcript's pending question leaves its row for the cluster */}
															{approvalPresentation === "dock" &&
																transcriptQuestionId !== null &&
																pendingQuestion !== null && (
																	<Fragment key={transcriptQuestionId}>
																		{pendingQuestionCard(
																			{
																				toolUseId: transcriptQuestionId,
																				questions: pendingQuestion.questions,
																				ctx: askUserQuestionCtx,
																				sent: transcriptQuestionSent,
																				presentation: "dock",
																				queueDepth,
																			},
																		)}
																	</Fragment>
																)}
														</div>
													</ApprovalClusterHost>
												}
												turnBox={
													shownPlan.todos === null ? undefined : (
														<TurnPlanBoxCard
															sessionId={sessionId}
															todos={shownPlan.todos}
															closing={shownPlan.closing}
															stale={planBox?.stale ?? false}
															working={planBox?.working ?? false}
															parked={compactInFlight}
															agentsRunning={planState.agentsRunning}
															isResponding={turnResponding}
														/>
													)
												}
												actionsOutletRef={tailActions.set}
												chrome={tailChrome}
											/>
											{lineAfterTranscript &&
												lineShown &&
												tailChrome === undefined &&
												workingLine(false)}

											<SideChat sessionId={sessionId} messageCount={data.messageCount} />
										</div>
									</RailTileFrame>
								</TileHost>
							</div>
						</TurnMarkOutletProvider>
					</SessionMentionsProvider>
				</ApprovalDockContext.Provider>
			</TerminalWritesTipProvider>
		</SessionTurnProvider>
	);
}
