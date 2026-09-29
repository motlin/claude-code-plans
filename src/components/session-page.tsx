import { useElementScrollRestoration, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { SessionChat } from "./session-chat";
import { Composer } from "./composer";
import { StreamingMessage } from "./streaming-message";
import { SessionHookContext } from "./session-hook-context";
import { useSettings } from "./settings-provider";
import { useTranscriptModeShortcut } from "../hooks/use-session-transcript-mode";
import { sessionHasThinking } from "../lib/transcript-mode";
import { SessionTitlebar } from "./session-titlebar";
import { TITLEBAR_ICON_BUTTON_CLASS } from "./titlebar-classes";
import { useHasUnseenWork } from "./session-unread-control";
import { syncUnseenFromSummaries } from "../lib/unread-store";
import {
  AskUserQuestionProvider,
  type AskUserQuestionContextValue,
} from "./ask-user-question-context";
import { SessionFileRefs } from "./file-refs";
import type { JumpTargetWindow } from "./jump-target-context";
import { LegacyMessageLinkNotice } from "./legacy-message-link-notice";
import { TileHost } from "./panes/tile-host";
import { useRegisterArtifactsPane, useSessionArtifacts } from "./panes/artifacts-pane";
import { useRegisterBackgroundTasksPane } from "./panes/background-tasks-pane";
import { useRegisterLinksPane } from "./panes/links-pane";
import { useRegisterPlanPane } from "./panes/plan-pane";
import { ChangesPaneShortcut, useRegisterChangesPane } from "./changes/changes-pane";
import {
  FilesPaneShortcut,
  useExtractedSessionFiles,
  useRegisterFilesPane,
} from "./panes/files-pane";
import { TerminalPaneShortcut, useRegisterTerminalPane } from "./panes/terminal-pane";
import { StatusFooter } from "./status-footer";
import { BranchStrip } from "./branch-strip";
import { TranscriptHistoryLoader, findScrollContainer } from "./transcript-history-loader";
import { Tooltip } from "./ui/tooltip";
import { SessionPaneControls } from "./view-options-menu";
import { SessionDock } from "./session-dock";
import { handleBtwPrompt, SideChat, useSideChatShortcut } from "./side-chat";
import { useToast } from "./toast";
import { transcriptWidthStyle } from "../lib/transcript-width";
import { useChatStream } from "../hooks/use-chat-stream";
import { useShortcutKeys } from "../hooks/use-shortcut";
import {
  useClaudeEvents,
  useComposerServerState,
  useIsSessionActive,
  useStatusline,
} from "../hooks/use-claude-events";
import {
  lastAssistantModelFromRecords,
  lastPermissionModeFromRecords,
  resolveComposerState,
} from "../lib/composer-state";
import { useSessionViewedState } from "../hooks/use-session-viewed-state";
import { usePendingMessageJump } from "../hooks/use-pending-message-jump";
import { postAnswerQuestion } from "../lib/api/answer-question";
import { applicationSettingsQueryOptions } from "../lib/api/application-settings";
import { herdrPanesQueryOptions, sendHerdrPrompt } from "../lib/api/herdr";
import type { HerdrPaneIndexData } from "../lib/api/herdr";
import type { PaneKind } from "../lib/pane-layout";
import {
  sessionDetailQueryOptions,
  sessionResourcesQueryOptions,
  sessionSubagentsQueryOptions,
  transcriptEndIndex,
  transcriptQueryOptions,
  useRequestSummary,
} from "../lib/api/sessions";
import type { SessionDetailData, SessionSubagentsData, TranscriptData } from "../lib/api/sessions";
import { countMessageRecords } from "../lib/message-count";
import {
  getSubagentLifecycleKey,
  extractPendingSubagents,
  type ActiveSubagent,
} from "../lib/subagents";
import { processTranscript } from "../lib/transcript";
import { backgroundTasksFacts, extractBackgroundTasks } from "../lib/background-tasks";
import { createSessionCommands } from "../lib/session-commands";

const TRANSCRIPT_SCROLL_CONTAINER_CLASSES =
  "h-full overflow-y-auto overflow-x-hidden [contain:strict] [overflow-anchor:none] [scrollbar-gutter:stable_both_edges]";

/** Marks the element that scrolls the transcript as the contained, virtualized scroller. */
function useTranscriptScrollContainment(anchorRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const scroller = findScrollContainer(anchorRef.current);
    const addedClasses = TRANSCRIPT_SCROLL_CONTAINER_CLASSES.split(" ").filter(
      (className) => !scroller.classList.contains(className),
    );
    scroller.classList.add(...addedClasses);
    return () => {
      scroller.classList.remove(...addedClasses);
    };
  }, [anchorRef]);
}

interface SessionPromptBehavior {
  disabled: boolean;
  deliveryHint: string;
  hasLivePane: boolean;
  usesHerdr: boolean;
}

export function getSessionPromptBehavior(
  sessionId: string,
  isActive: boolean,
  herdr: { panes: Array<{ sessionId: string }>; writesEnabled: boolean },
): SessionPromptBehavior {
  const hasLivePane = herdr.panes.some((pane) => pane.sessionId === sessionId);

  if (!hasLivePane) {
    return {
      disabled: isActive,
      deliveryHint: "Starts a forked session",
      hasLivePane,
      usesHerdr: false,
    };
  }
  if (!herdr.writesEnabled) {
    return {
      disabled: true,
      deliveryHint: "Live terminal input is disabled",
      hasLivePane,
      usesHerdr: false,
    };
  }
  return {
    disabled: false,
    deliveryHint: "Sends to the live terminal",
    hasLivePane,
    usesHerdr: true,
  };
}

interface LiveHerdrPromptState {
  error: string;
  isPending: boolean;
  prompt: string;
}

const EMPTY_LIVE_HERDR_PROMPT_STATE: LiveHerdrPromptState = {
  error: "",
  isPending: false,
  prompt: "",
};

export function useLiveHerdrPrompt(
  sessionId: string,
  transcriptRecordCount: number,
  postPrompt: (sessionId: string, prompt: string) => Promise<void> = sendHerdrPrompt,
) {
  const [state, setState] = useState<LiveHerdrPromptState>(EMPTY_LIVE_HERDR_PROMPT_STATE);
  const pendingRecordCountRef = useRef<number | null>(null);

  useEffect(() => {
    pendingRecordCountRef.current = null;
    setState(EMPTY_LIVE_HERDR_PROMPT_STATE);
  }, [sessionId]);

  useEffect(() => {
    const pendingRecordCount = pendingRecordCountRef.current;
    if (pendingRecordCount === null || transcriptRecordCount <= pendingRecordCount) return;
    pendingRecordCountRef.current = null;
    setState(EMPTY_LIVE_HERDR_PROMPT_STATE);
  }, [transcriptRecordCount]);

  const send = useCallback(
    async (prompt: string) => {
      pendingRecordCountRef.current = transcriptRecordCount;
      setState({ error: "", isPending: true, prompt });
      try {
        await postPrompt(sessionId, prompt);
      } catch (error) {
        pendingRecordCountRef.current = null;
        setState({
          error: error instanceof Error ? error.message : "Failed to send prompt",
          isPending: false,
          prompt,
        });
      }
    },
    [postPrompt, sessionId, transcriptRecordCount],
  );

  return { send, state };
}

export function routeSessionPrompt(
  usesHerdr: boolean,
  sessionId: string,
  prompt: string,
  sendLivePrompt: (prompt: string) => Promise<void>,
  sendForkedPrompt: (sessionId: string, prompt: string) => Promise<void>,
): void {
  if (usesHerdr) {
    void sendLivePrompt(prompt);
    return;
  }
  void sendForkedPrompt(sessionId, prompt);
}

function SessionChrome({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

function SessionSkeleton() {
  return (
    <SessionChrome>
      <div className="flex h-8 items-center">
        <div className="h-5 w-1/3 animate-pulse rounded bg-fill-ghost-hover" />
      </div>
      <div className="mt-6 space-y-4" data-testid="session-skeleton">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="rounded-lg border border-border p-4">
            <div className="h-3 w-24 animate-pulse rounded bg-fill-ghost-hover" />
            <div className="mt-3 h-3 w-full animate-pulse rounded bg-fill-ghost-hover" />
            <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-fill-ghost-hover" />
          </div>
        ))}
      </div>
    </SessionChrome>
  );
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

export function SessionPage({
  sessionId,
  requestedPane,
  onRequestedPaneHandled,
}: { sessionId: string } & RequestedPaneProps) {
  // Plain `useQuery` (not suspense) so the app shell stays painted and this
  // page can show its own skeleton while the transcript payload loads.
  const detailQuery = useQuery(sessionDetailQueryOptions(sessionId));
  const transcriptQuery = useQuery(transcriptQueryOptions(sessionId));
  const subagentsQuery = useQuery(sessionSubagentsQueryOptions(sessionId));
  const herdrQuery = useQuery(herdrPanesQueryOptions);

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
  if (!data || !transcript || !subagents || !herdr) return <SessionSkeleton />;

  return (
    <SessionView
      sessionId={sessionId}
      data={data}
      transcript={transcript}
      subagents={subagents}
      herdr={herdr}
      requestedPane={requestedPane}
      onRequestedPaneHandled={onRequestedPaneHandled}
    />
  );
}

interface SessionViewProps extends RequestedPaneProps {
  sessionId: string;
  data: SessionDetailData;
  transcript: TranscriptData;
  subagents: SessionSubagentsData;
  herdr: HerdrPaneIndexData;
}

function SessionView({
  sessionId,
  data,
  transcript,
  subagents,
  herdr,
  requestedPane,
  onRequestedPaneHandled,
}: SessionViewProps) {
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  useTranscriptScrollContainment(scrollAnchorRef);
  const initialScrollKey = useLocation({
    select: (location) => location.state.__TSR_key ?? location.href,
  });
  const locationHash = useLocation({ select: (location) => location.hash });
  const restoredScrollPosition = useElementScrollRestoration({ id: "main" });
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
  const viewedState = useSessionViewedState(sessionId, currentMessageIndex);
  const { visibilityRef } = viewedState;
  const sessionViewRef = useCallback(
    (element: HTMLDivElement | null) => {
      scrollAnchorRef.current = element;
      visibilityRef(element);
    },
    [visibilityRef],
  );
  const detailUnseen = !data.viewedState.viewedAnywhere;
  useEffect(() => {
    syncUnseenFromSummaries([{ id: sessionId, unseen: detailUnseen }]);
  }, [detailUnseen, sessionId]);
  const unseen = useHasUnseenWork(sessionId);
  const { settings, setSetting } = useSettings();
  // Keyed off the window's startIndex so every line carries its session-absolute
  // JSONL record index, which locates a row whose record was collapsed into a
  // neighbour and resolves links copied before anchors moved to message uuids.
  const processed = useMemo(
    () => processTranscript(transcript.records, transcript.startIndex),
    [transcript.records, transcript.startIndex],
  );
  const hasThinking = useMemo(() => sessionHasThinking(processed.lines), [processed.lines]);
  const transcriptView = useTranscriptModeShortcut(sessionId, { hasThinking });
  const { mode: transcriptMode, flags: transcriptFlags } = transcriptView;
  // `uuidToLine` is the set of messages the window holds, which is how a jump
  // decides whether to scroll or to page history in first.
  const requestMessageJump = usePendingMessageJump(
    sessionId,
    transcript.startIndex,
    processed.uuidToLine,
  );
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
    () => ({ windowStartIndex: transcript.startIndex, requestMessageJump }),
    [requestMessageJump, transcript.startIndex],
  );
  useRegisterFilesPane({
    sessionId,
    cwd: data.projectPath ?? undefined,
    windowFiles,
    windowStartIndex: transcript.startIndex,
    jumpTargetWindow,
  });
  const sessionArtifacts = useSessionArtifacts(sessionId);
  useRegisterArtifactsPane(sessionArtifacts);
  useRegisterPlanPane(data.planFilename);
  useRegisterLinksPane({
    sessionId,
    lines: processed.lines,
    windowStartIndex: transcript.startIndex,
    jumpTargetWindow,
  });
  const { hookContexts, runningSubagents } = useClaudeEvents();
  const hookContext = hookContexts.get(sessionId);
  const transcriptActiveSubagents = useMemo(
    () => extractPendingSubagents(transcript.records),
    [transcript.records],
  );
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
  const backgroundTasks = useMemo(
    () =>
      extractBackgroundTasks(transcript.records, {
        sessionActive: isActive,
        runningSubagents: activeSubagents,
        ...(hookContext?.backgroundTasks === undefined
          ? {}
          : { hookTasks: hookContext.backgroundTasks }),
      }),
    [transcript.records, isActive, activeSubagents, hookContext?.backgroundTasks],
  );
  useRegisterBackgroundTasksPane(sessionId, backgroundTasks, subagents.length);
  const statusline = useStatusline(sessionId);
  const composerServerState = useComposerServerState(sessionId);
  const composerChin = useMemo(
    () =>
      resolveComposerState({
        hookPermissionMode: hookContext?.permissionMode,
        jsonlPermissionMode: lastPermissionModeFromRecords(transcript.records),
        settingsDefaultMode: composerServerState?.settingsDefaultMode ?? null,
        statuslineModel: composerServerState?.statusline?.model?.display_name ?? null,
        lastAssistantModel: lastAssistantModelFromRecords(transcript.records),
        settingsEffortLevel: composerServerState?.settingsEffortLevel ?? null,
        statusline: composerServerState?.statusline ?? null,
        statuslineUpdatedAt: composerServerState?.statuslineUpdatedAt ?? null,
      }),
    [hookContext?.permissionMode, transcript.records, composerServerState],
  );
  const [generating, setGenerating] = useState(false);
  const summaryMutation = useRequestSummary(sessionId);
  const chromeHidden = settings.chromeHidden;
  const setChromeHidden = useCallback((v: boolean) => setSetting("chromeHidden", v), [setSetting]);
  const chromeShortcut = useShortcutKeys("expand_collapse_pane");
  const toggleChromeHidden = useCallback(
    () => setChromeHidden(!chromeHidden),
    [chromeHidden, setChromeHidden],
  );

  const submitAnswer = useCallback(
    async ({
      toolUseId,
      answers,
    }: {
      toolUseId: string;
      answers: Array<{ question: string; answer: string }>;
    }) => {
      await postAnswerQuestion({ sessionId, toolUseId, answers });
    },
    [sessionId],
  );
  const askUserQuestionCtx: AskUserQuestionContextValue = useMemo(
    () => ({ isSessionActive: isActive, submitAnswer }),
    [isActive, submitAnswer],
  );
  const chatStream = useChatStream();
  const toast = useToast();
  const liveHerdrPrompt = useLiveHerdrPrompt(sessionId, endIndex);
  const promptBehavior = getSessionPromptBehavior(sessionId, isActive, herdr);
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

  const sessionCommands = createSessionCommands(sessionId, data.projectPath);

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
    <div ref={sessionViewRef} style={transcriptWidthStyle(settings.transcriptWidth)}>
      <TileHost
        sessionId={sessionId}
        onExpandWithoutPane={toggleChromeHidden}
        requestedPane={requestedPane}
        onRequestedPaneHandled={onRequestedPaneHandled}
      >
        <TerminalPaneShortcut available={promptBehavior.hasLivePane || shellsEnabled} />
        <FilesPaneShortcut />
        <ChangesPaneShortcut />
        {/* Sticky header: titlebar + hook context */}
        {!chromeHidden && (
          <div
            data-transcript-sticky-header
            className="sticky top-0 z-10 bg-surface-2 pb-1 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-border"
          >
            <SessionTitlebar
              sessionId={sessionId}
              data={data}
              isActive={isActive}
              local={{
                resumeCommand: sessionCommands.resume,
                forkCommand: sessionCommands.fork,
                reviewed: !unseen,
                onToggleReviewed: unseen ? viewedState.markReviewed : viewedState.markUnreviewed,
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
                  facts={{
                    artifactCount: sessionArtifacts.length,
                    hasPlan: data.planFilename !== undefined,
                    backgroundTasks: backgroundTasksFacts(backgroundTasks, subagents.length),
                    subagentCount: subagents.length,
                  }}
                  extras={
                    <Tooltip content="Expand chat" shortcut={chromeShortcut.keys} side="bottom">
                      <button
                        type="button"
                        onClick={() => setChromeHidden(true)}
                        className={TITLEBAR_ICON_BUTTON_CLASS}
                        aria-label="Expand chat"
                        aria-keyshortcuts={chromeShortcut.ariaKeyShortcuts}
                      >
                        <Maximize2 aria-hidden="true" />
                      </button>
                    </Tooltip>
                  }
                />
              }
            />

            {hookContext && <SessionHookContext context={hookContext} />}
          </div>
        )}

        {/* Floating restore button when chrome is hidden */}
        {chromeHidden && (
          <div className="sticky top-0 z-10 flex justify-end py-1">
            <Tooltip content="Show header and footer" shortcut={chromeShortcut.keys}>
              <button
                type="button"
                onClick={() => setChromeHidden(false)}
                className="rounded-md bg-surface-0 border border-border px-2 py-1 text-xs text-t6 hover:text-primary hover:bg-fill-control transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                aria-keyshortcuts={chromeShortcut.ariaKeyShortcuts}
              >
                <Minimize2 className="h-3 w-3" />
                Show chrome
              </button>
            </Tooltip>
          </div>
        )}

        <LegacyMessageLinkNotice hash={locationHash} />

        {/* Chat messages */}
        <AskUserQuestionProvider value={askUserQuestionCtx}>
          <TranscriptHistoryLoader sessionId={sessionId} startIndex={transcript.startIndex} />
          <SessionFileRefs
            sessionId={sessionId}
            cwd={data.projectPath ?? undefined}
            sessionFiles={resources?.files ?? windowFiles}
          >
            <SessionChat
              sessionId={sessionId}
              lines={processed.lines}
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
              initialScrollKey={initialScrollKey}
              shouldScrollToEnd={restoredScrollPosition === undefined && locationHash === ""}
              summary={aiSummary}
            />
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

        {liveHerdrPrompt.state.prompt !== "" && (
          <StreamingMessage
            text=""
            isComplete={!liveHerdrPrompt.state.isPending}
            error={liveHerdrPrompt.state.error || undefined}
            sentPrompt={liveHerdrPrompt.state.prompt}
            pendingLabel="Sent to live session — waiting for transcript..."
          />
        )}

        <SideChat sessionId={sessionId} messageCount={data.messageCount} />

        {/* Sticky footer: the composer dock + status bar */}
        <div className="sticky bottom-0 z-10 -mx-4 -mb-8 sm:-mx-8">
          <div
            className={
              !chromeHidden && data.projectPath
                ? "bg-surface-2 px-4 pt-2 pb-3 sm:px-8"
                : "px-4 sm:px-8"
            }
          >
            <SessionDock anchorRef={scrollAnchorRef}>
              {!chromeHidden && data.projectPath && (
                <BranchStrip sessionId={sessionId} session={data} statusline={statusline} />
              )}
              {!chromeHidden && data.projectPath && (
                <Composer
                  variant="session"
                  draftKey={sessionId}
                  onSend={(prompt) => {
                    if (
                      handleBtwPrompt(prompt, {
                        sessionId,
                        messageCount: data.messageCount,
                        toast,
                      })
                    ) {
                      return;
                    }
                    routeSessionPrompt(
                      promptBehavior.usesHerdr,
                      sessionId,
                      prompt,
                      liveHerdrPrompt.send,
                      chatStream.send,
                    );
                  }}
                  onCancel={chatStream.cancel}
                  isStreaming={!promptBehavior.usesHerdr && chatStream.state.isStreaming}
                  disabled={promptBehavior.disabled || liveHerdrPrompt.state.isPending}
                  deliveryHint={promptBehavior.deliveryHint}
                  chin={composerChin}
                />
              )}
            </SessionDock>
          </div>
          {statusline && <StatusFooter data={statusline} messageCount={data.messageCount} />}
        </div>
      </TileHost>
    </div>
  );
}
