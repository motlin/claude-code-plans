import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SessionChat } from "../components/session-chat";
import { ChatInput } from "../components/chat-input";
import { StreamingMessage } from "../components/streaming-message";
import { useChatStream } from "../hooks/use-chat-stream";
import {
  AskUserQuestionProvider,
  type AskUserQuestionContextValue,
} from "../components/ask-user-question-context";
import {
  sessionDetailQueryOptions,
  transcriptQueryOptions,
  useRequestSummary,
  useToggleSessionStar,
} from "../lib/api/sessions";
import { extractSubagents } from "../lib/subagents";
import { useIsSessionActive, useStatusline } from "../hooks/use-claude-events";
import { StatusFooter } from "../components/status-footer";
import { processTranscript } from "../lib/transcript";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Copy,
  Terminal,
  GitFork,
  Download,
  Maximize2,
  Minimize2,
  Users,
} from "lucide-react";
import { DetailTopBar, pillStyles } from "../components/detail-top-bar";
import { useSettings } from "../components/settings-provider";

export const Route = createFileRoute("/session/$id")({
  component: SessionPage,
  loader: async ({ context: { queryClient }, params }) => {
    const [meta] = await Promise.all([
      queryClient.ensureQueryData(sessionDetailQueryOptions(params.id)),
      queryClient.ensureQueryData(transcriptQueryOptions(params.id)),
    ]);
    return meta;
  },
  errorComponent: SessionErrorComponent,
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title ?? "Session Not Found" }],
  }),
});

function SessionErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const message = error instanceof Error ? error.message : "Failed to load session";

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold text-red-600 dark:text-red-400">
        Failed to load session
      </h1>
      <pre className="mt-3 max-w-2xl overflow-auto rounded-md border border-border-300/15 bg-bg-200 p-3 font-mono text-sm text-text-500">
        {message}
      </pre>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-accent-100 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-100/80"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={() => router.navigate({ to: "/sessions" })}
          className="rounded-md border border-border-300/15 px-3 py-1.5 text-sm font-medium text-text-300 hover:bg-bg-200"
        >
          Back to sessions
        </button>
      </div>
    </div>
  );
}

function useScrollButtons() {
  const [showUp, setShowUp] = useState(false);
  const [showDown, setShowDown] = useState(false);

  useEffect(() => {
    function check() {
      const scrollTop = window.scrollY;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;
      setShowUp(scrollTop > 300);
      setShowDown(scrollTop + clientHeight < scrollHeight - 300);
    }
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check, { passive: true });
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  return { showUp, showDown };
}

function FloatingScrollButtons() {
  const { showUp, showDown } = useScrollButtons();

  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-20">
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="h-9 w-9 rounded-full bg-bg-200 border border-border-300/15 shadow-md flex items-center justify-center text-text-500 hover:text-text-000 hover:bg-bg-200/80 transition-all cursor-pointer"
        style={{
          opacity: showUp ? 1 : 0,
          pointerEvents: showUp ? "auto" : "none",
        }}
        title="Scroll to top"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() =>
          window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: "smooth",
          })
        }
        className="h-9 w-9 rounded-full bg-bg-200 border border-border-300/15 shadow-md flex items-center justify-center text-text-500 hover:text-text-000 hover:bg-bg-200/80 transition-all cursor-pointer"
        style={{
          opacity: showDown ? 1 : 0,
          pointerEvents: showDown ? "auto" : "none",
        }}
        title="Scroll to bottom"
      >
        <ArrowDown className="h-4 w-4" />
      </button>
    </div>
  );
}

function CopyButton({
  title,
  text,
  icon: Icon,
}: {
  title: string;
  text: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        title={title}
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="text-text-500 hover:text-text-000 transition-colors cursor-pointer"
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
      <span
        className={`absolute -bottom-6 left-1/2 -translate-x-1/2 rounded bg-bg-200 px-1.5 py-0.5 text-[10px] text-text-300 shadow-sm transition-opacity whitespace-nowrap ${copied ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        Copied!
      </span>
    </div>
  );
}

function SessionPage() {
  const params = Route.useParams();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(sessionDetailQueryOptions(params.id));
  const { data: transcript } = useSuspenseQuery(transcriptQueryOptions(params.id));

  const processed = useMemo(() => processTranscript(transcript.records), [transcript.records]);
  const subagentCount = useMemo(() => {
    if (!data?.projectId) return 0;
    return extractSubagents(transcript.records, data.projectId).length;
  }, [transcript.records, data?.projectId]);
  const [aiSummary, setAiSummary] = useState<string | null>(data?.summary ?? null);
  const summaryLoaded = true;
  const [starred, setStarred] = useState(data?.starred ?? false);
  const isActive = useIsSessionActive(params.id);
  const statusline = useStatusline(params.id);
  const [generating, setGenerating] = useState(false);
  const summaryMutation = useRequestSummary(params.id);
  const starMutation = useToggleSessionStar(params.id);
  const { settings, setSetting } = useSettings();
  const chromeHidden = settings.chromeHidden;
  const setChromeHidden = useCallback((v: boolean) => setSetting("chromeHidden", v), [setSetting]);
  const chromeHiddenRef = useRef(chromeHidden);
  chromeHiddenRef.current = chromeHidden;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "f") {
        e.preventDefault();
        setChromeHidden(!chromeHiddenRef.current);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setChromeHidden]);

  const submitAnswer = useCallback(
    async ({
      toolUseId,
      answers,
    }: {
      toolUseId: string;
      answers: Array<{ question: string; answer: string }>;
    }) => {
      const res = await fetch("/api/answer-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: params.id, toolUseId, answers }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      // Drain the stream so the spawned `claude --resume` runs to
      // completion in the background. The SSE watcher will refresh the
      // session view once the new JSONL is written.
      const reader = res.body?.getReader();
      if (reader) {
        try {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        } finally {
          reader.releaseLock();
        }
      }
    },
    [params.id],
  );
  const askUserQuestionCtx: AskUserQuestionContextValue = useMemo(
    () => ({ isSessionActive: isActive, submitAnswer }),
    [isActive, submitAnswer],
  );
  const chatStream = useChatStream();
  const prevSessionIdRef = useRef(params.id);

  useEffect(() => {
    if (prevSessionIdRef.current !== params.id) {
      prevSessionIdRef.current = params.id;
      chatStream.reset();
    }
  }, [params.id, chatStream]);

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
      completionRecordCountRef.current = transcript.records.length;
      return;
    }
    if (transcript.records.length > completionRecordCountRef.current) {
      completionRecordCountRef.current = null;
      chatStream.reset();
    }
  }, [
    chatStream,
    chatStream.state.isStreaming,
    chatStream.state.isComplete,
    transcript.records.length,
  ]);

  useEffect(() => {
    setAiSummary(data?.summary ?? null);
  }, [params.id, data?.summary]);

  if (!data) {
    return (
      <div>
        <DetailTopBar>
          <Link to="/sessions" className={pillStyles.primary}>
            <ArrowLeft className="h-3.5 w-3.5" />
            All Sessions
          </Link>
        </DetailTopBar>
        <h1 className="mt-4 text-lg font-semibold">Session Not Found</h1>
        <p className="mt-2 text-text-500">This session could not be found.</p>
      </div>
    );
  }

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
    <div>
      {/* Sticky header: top bar + title + subagent link */}
      {!chromeHidden && (
        <div className="sticky top-0 z-10 bg-bg-000 pb-2 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-border-300/15">
          <DetailTopBar>
            {data.parentSessionId ? (
              <Link
                to="/session/$id"
                params={{ id: data.parentSessionId }}
                className={pillStyles.primary}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Parent Session
              </Link>
            ) : (
              <Link to="/sessions" className={pillStyles.primary}>
                <ArrowLeft className="h-3.5 w-3.5" />
                All Sessions
              </Link>
            )}
            <span className="text-xs text-text-500" title={data.projectPath ?? undefined}>
              {data.projectName}
            </span>
            {data.entrypoint && data.entrypoint !== "cli" && (
              <span className="inline-flex items-center rounded-full bg-bg-200 px-2 py-0.5 text-xs font-medium text-text-500">
                {data.entrypoint}
              </span>
            )}
            {data.sessionKind && (
              <span className="inline-flex items-center rounded-full bg-bg-200 px-2 py-0.5 text-xs font-medium text-text-500">
                {data.sessionKind}
              </span>
            )}
            {data.teamNames?.map((team) => (
              <span
                key={team}
                className="inline-flex items-center gap-1 rounded-full bg-bg-200 px-2 py-0.5 text-xs font-medium text-text-500"
              >
                <Users className="h-3 w-3" />
                {team}
              </span>
            ))}
            {data.forkedFromSessionId && (
              <Link
                to="/session/$id"
                params={{ id: data.forkedFromSessionId }}
                className="inline-flex items-center gap-1 rounded-full bg-bg-200 px-2 py-0.5 text-xs font-medium text-text-500 no-underline transition-colors hover:bg-bg-300/70"
                title={`Forked from ${data.forkedFromSessionId}`}
              >
                <GitFork className="h-3 w-3" />
                Forked from {data.forkedFromSessionId.slice(0, 8)}
              </Link>
            )}
            {isActive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-900 px-2 py-0.5 text-xs font-medium text-success-000">
                <span className="h-1.5 w-1.5 rounded-full bg-success-000 animate-pulse" />
                Active
              </span>
            )}
            <CopyButton title="Copy session ID" text={params.id} icon={Copy} />
            <CopyButton
              title="Copy resume command"
              text={`claude -r ${params.id}`}
              icon={Terminal}
            />
            <CopyButton
              title="Copy fork command"
              text={`claude -r ${params.id} --fork-session`}
              icon={GitFork}
            />
            <a
              href={`/api/raw?sessionId=${params.id}`}
              download
              className="text-text-500 hover:text-text-000 transition-colors"
              title="Download raw JSONL"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              onClick={async () => {
                const result = await starMutation.mutateAsync(!starred);
                setStarred(result.starred);
                void queryClient.invalidateQueries({
                  queryKey: ["starred-sessions"],
                });
              }}
              className="shrink-0 cursor-pointer text-text-500 transition-colors hover:text-warning-000"
              title={starred ? "Unstar session" : "Star session"}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill={starred ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                style={{ color: starred ? "rgb(234, 179, 8)" : undefined }}
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setChromeHidden(true)}
              className="ml-auto shrink-0 cursor-pointer text-text-500 transition-colors hover:text-text-000"
              title="Expand chat (Ctrl+Shift+F)"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </DetailTopBar>
          <h1 className="text-lg font-semibold">{data.title}</h1>

          {aiSummary ? (
            <p className="mt-1 text-sm text-text-500 italic">{aiSummary}</p>
          ) : (
            summaryLoaded &&
            settings.showSummaryButton && (
              <button
                type="button"
                onClick={handleGenerateSummary}
                disabled={generating}
                className="mt-1 text-xs text-accent-100 hover:underline disabled:opacity-50 disabled:no-underline"
              >
                {generating ? "Generating summary..." : "Generate AI summary"}
              </button>
            )
          )}

          {subagentCount > 0 && (
            <Link
              to="/session/$id/subagents"
              params={{ id: params.id }}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent-100 hover:underline"
            >
              <GitFork className="h-3 w-3" />
              {subagentCount} subagent{subagentCount === 1 ? "" : "s"}
            </Link>
          )}
        </div>
      )}

      {/* Floating restore button when chrome is hidden */}
      {chromeHidden && (
        <div className="sticky top-0 z-10 flex justify-end py-1">
          <button
            type="button"
            onClick={() => setChromeHidden(false)}
            className="rounded-md bg-bg-200 border border-border-300/15 px-2 py-1 text-xs text-text-500 hover:text-text-000 hover:bg-bg-300/70 transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            title="Show header and footer (Ctrl+Shift+F)"
          >
            <Minimize2 className="h-3 w-3" />
            Show chrome
          </button>
        </div>
      )}

      {/* Chat messages */}
      <AskUserQuestionProvider value={askUserQuestionCtx}>
        <SessionChat
          sessionId={params.id}
          lines={processed.lines}
          toolResultMap={processed.toolResultMap}
          showThinking={settings.showThinking}
          showTools={settings.showTools}
          showPassedHooks={settings.showPassedHooks}
          showHookWarnings={settings.showHookWarnings}
          showHookErrors={settings.showHookErrors}
          showSystemBanners={settings.showSystemBanners}
          showCompactSummaries={settings.showCompactSummaries}
          showTranscriptOnly={settings.showTranscriptOnly}
        />
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

      <FloatingScrollButtons />

      {/* Sticky footer: chat input + status bar */}
      {((!chromeHidden && data.projectPath) || statusline) && (
        <div className="sticky bottom-0 z-10 -mx-4 -mb-8 sm:-mx-8">
          {!chromeHidden && data.projectPath && (
            <ChatInput
              onSend={(prompt) => chatStream.send(params.id, prompt)}
              onCancel={chatStream.cancel}
              isStreaming={chatStream.state.isStreaming}
              disabled={isActive}
              projectPath={data.projectPath}
            />
          )}
          {statusline && (
            <StatusFooter
              data={statusline}
              gitBranch={data.gitBranch}
              gitSha={data.gitSha}
              gitClean={data.gitClean}
              messageCount={data.messageCount}
              pendingTaskCount={data.pendingTaskCount}
            />
          )}
        </div>
      )}
    </div>
  );
}
