import React, { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Copy,
  FileWarning,
  GitBranch,
  Link,
  Link2,
  Lock,
  Palette,
  Plug,
  Zap,
} from "lucide-react";
import { assertNever } from "../lib/assert-never";
import { formatTimestamp, formatRelativeTimestamp } from "../lib/timestamp-format";
import { MarkdownArticle } from "./markdown-article";
import { getToolRenderer } from "./tool-renderers";
import {
  buildClientToolCall,
  buildSubagentLookup,
  getToolDescription,
} from "./tool-renderers/types";
import type { ClientToolCall } from "./tool-renderers";
import type { LiveToolFailure, SubagentLookup } from "./tool-renderers/types";
import type { Subagent } from "../lib/subagents";
import { useClaudeEvents } from "../hooks/use-claude-events";
import {
  ChevronIcon,
  CollapsibleSection,
  CopyButton,
  TerminalOutput,
} from "./tool-renderers/shared";
import { SystemBanner, formatTokens } from "./system-banner";
import { promptSourceLabels } from "../lib/schema-choices";
import { computeDiffData } from "../lib/diff-utils";
import { TasksView } from "./tasks-view";
import { DebugLink } from "./debug-link";
import { useSettings } from "./settings-provider";
import { hmrPersist } from "../lib/hmr-persist";
import { writeClipboardText } from "../lib/clipboard";
import type {
  MessageSessionLine,
  SessionLine,
  SessionContentBlock,
  ToolResultInfo,
} from "../lib/sessions";
import type { ToolUseBlock } from "../lib/schemas";
import { AttachmentBanner, Banner, Pre } from "./attachment-banner";
import {
  stripCommandTags,
  parseCommandBlock,
  parseBashInput,
  parseBashOutput,
  formatToolName,
  summarizeToolCallsStructured,
  editDiffEntries,
} from "../lib/session-utils";
import type { SummarySegment } from "../lib/session-utils";
import { InlinePathImages, SESSION_IMAGE_CLASS_NAME } from "./inline-path-images";

function getLineTimestamp(line: SessionLine): string | undefined {
  if ("timestamp" in line) return line.timestamp;
  return undefined;
}

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
  initialScrollKey?: string;
  shouldScrollToEnd?: boolean;
}

const autoScrolledLocations = hmrPersist("autoScrolledLocations", () => new Set<string>());
const EMPTY_IMAGE_ROOTS: readonly string[] = [];
const END_FOLLOW_THRESHOLD_PIXELS = 32;

function CopyToast({ visible }: { visible: boolean }) {
  return (
    <span
      className={`absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-bg-200 px-1.5 py-0.5 text-[10px] text-text-300 shadow-sm transition-opacity whitespace-nowrap pointer-events-none ${visible ? "opacity-100" : "opacity-0"}`}
    >
      Copied!
    </span>
  );
}

function MessageToolbar({
  line,
  index,
  timestamp,
}: {
  line: MessageSessionLine;
  index: number;
  timestamp?: string;
}) {
  const [copied, setCopied] = useState<"text" | "link" | null>(null);
  const usage = summarizeUsage(line.usage);
  const relativeTimestamp = formatRelativeTimestamp(timestamp);
  const absoluteTimestamp = formatTimestamp(timestamp);
  const timestampTitle = absoluteTimestamp ?? undefined;

  async function copyText() {
    const texts = extractTextFromLine(line);
    const ok = await writeClipboardText(texts.join("\n\n"));
    if (ok) {
      setCopied("text");
      setTimeout(() => setCopied(null), 1500);
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}#msg-${index}`;
    const ok = await writeClipboardText(url);
    if (ok) {
      setCopied("link");
      setTimeout(() => setCopied(null), 1500);
    }
  }

  return (
    <div className="flex gap-g2 pt-[4px] -mt-[8px] opacity-0 pointer-events-none group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity duration-150">
      <div className="relative">
        <button
          type="button"
          aria-label="Copy message"
          onClick={copyText}
          className="p-1 text-text-500 hover:text-text-000 cursor-pointer"
        >
          <Copy className="h-3 w-3" />
        </button>
        <CopyToast visible={copied === "text"} />
      </div>
      <div className="relative">
        <button
          type="button"
          aria-label="Copy link"
          onClick={copyLink}
          className="p-1 text-text-500 hover:text-text-000 cursor-pointer"
        >
          <Link2 className="h-3 w-3" />
        </button>
        <CopyToast visible={copied === "link"} />
      </div>
      {relativeTimestamp && (
        <span
          className="text-[11px] text-assistant-secondary tabular-nums self-center pl-p1"
          title={timestampTitle}
        >
          {relativeTimestamp}
        </span>
      )}
      {line.stopReason === "max_tokens" && (
        <span className="text-[10px] text-warning-100 self-center rounded-full bg-bg-200 px-1.5">
          truncated · max tokens
        </span>
      )}
      {usage && (
        <span
          className="text-[11px] text-assistant-secondary tabular-nums self-center"
          title={usage.title}
        >
          {usage.summary}
        </span>
      )}
    </div>
  );
}

/** Compact token-usage summary from an assistant message's usage record. */
function summarizeUsage(
  usage: Record<string, unknown> | undefined,
): { summary: string; title: string } | undefined {
  if (!usage) return undefined;
  const num = (key: string): number =>
    typeof usage[key] === "number" ? (usage[key] as number) : 0;
  const input = num("input_tokens");
  const output = num("output_tokens");
  const cacheRead = num("cache_read_input_tokens");
  const cacheCreate = num("cache_creation_input_tokens");
  const totalIn = input + cacheRead + cacheCreate;
  if (totalIn === 0 && output === 0) return undefined;
  return {
    summary: `${formatTokens(totalIn)} in / ${formatTokens(output)} out`,
    title: `input ${input} · cache read ${cacheRead} · cache write ${cacheCreate} · output ${output}`,
  };
}

function extractTextFromLine(line: MessageSessionLine): string[] {
  const content = line.message?.content;
  if (!content) return [];
  if (typeof content === "string") return [stripCommandTags(content)].filter(Boolean);
  return content
    .filter(
      (b): b is SessionContentBlock & { text: string } =>
        b.type === "text" && typeof b.text === "string",
    )
    .map((b) => b.text);
}

function UserMessageActions({
  line,
  index,
  timestamp,
}: {
  line: MessageSessionLine;
  index: number;
  timestamp?: string;
}) {
  const [copied, setCopied] = useState<"text" | "link" | null>(null);

  async function copyText() {
    const texts = extractTextFromLine(line);
    const ok = await writeClipboardText(texts.join("\n\n"));
    if (ok) {
      setCopied("text");
      setTimeout(() => setCopied(null), 1500);
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}#msg-${index}`;
    const ok = await writeClipboardText(url);
    if (ok) {
      setCopied("link");
      setTimeout(() => setCopied(null), 1500);
    }
  }

  const absoluteTimestamp = formatTimestamp(timestamp);
  const relativeTimestamp = formatRelativeTimestamp(timestamp);
  const timestampTitle = absoluteTimestamp ?? undefined;

  return (
    <div className="flex items-center gap-2 px-1 pt-0.5 text-[11px] text-text-500 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150">
      <div className="relative">
        <button
          type="button"
          title="Copy message"
          onClick={copyText}
          className="flex items-center gap-0.5 hover:text-text-000 cursor-pointer"
        >
          <Copy className="h-3 w-3" />
          <span>Copy</span>
        </button>
        <CopyToast visible={copied === "text"} />
      </div>
      <div className="relative">
        <button
          type="button"
          title="Copy link"
          onClick={copyLink}
          className="flex items-center gap-0.5 hover:text-text-000 cursor-pointer"
        >
          <Link2 className="h-3 w-3" />
          <span>Link</span>
        </button>
        <CopyToast visible={copied === "link"} />
      </div>
      {relativeTimestamp && (
        <span className="text-text-500" title={timestampTitle}>
          {relativeTimestamp}
        </span>
      )}
    </div>
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
  initialScrollKey = sessionId,
  shouldScrollToEnd = true,
}: SessionChatProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isSubagentSession = sessionId.startsWith("agent-");
  const subagentLookup = useMemo(() => buildSubagentLookup(subagents), [subagents]);

  useEffect(() => {
    if (!shouldScrollToEnd || autoScrolledLocations.has(initialScrollKey)) return;

    let followsEnd = false;
    let initialFrame: number | undefined;
    let paintedFrame: number | undefined;
    let resizeFrame: number | undefined;

    const updateFollowsEnd = () => {
      const distanceFromEnd =
        document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      followsEnd = distanceFromEnd <= END_FOLLOW_THRESHOLD_PIXELS;
    };

    const resizeObserver = new ResizeObserver(() => {
      if (!followsEnd || resizeFrame !== undefined) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        if (!followsEnd) return;
        window.scrollTo({ top: document.documentElement.scrollHeight });
      });
    });
    const container = containerRef.current;
    if (!container) throw new Error("Expected the session chat container to be mounted.");
    resizeObserver.observe(container);
    window.addEventListener("scroll", updateFollowsEnd, { passive: true });

    initialFrame = requestAnimationFrame(() => {
      paintedFrame = requestAnimationFrame(() => {
        const end = endRef.current;
        if (!end) return;
        autoScrolledLocations.add(initialScrollKey);
        end.scrollIntoView({ block: "end" });
        followsEnd = true;
      });
    });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", updateFollowsEnd);
      if (initialFrame !== undefined) cancelAnimationFrame(initialFrame);
      if (paintedFrame !== undefined) cancelAnimationFrame(paintedFrame);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    };
  }, [initialScrollKey, shouldScrollToEnd]);

  return (
    <div ref={containerRef} className="mx-auto w-full max-w-3xl px-8 pt-4 pb-4 text-body">
      <SessionLineList
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
      />
      <div ref={endRef} />
    </div>
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

function LineEntry({
  line,
  index,
  nextLine,
  className,
  ...renderProps
}: LineRenderProps & {
  line: SessionLine;
  index: number;
  nextLine: SessionLine | undefined;
  className?: string;
}) {
  const content = renderSessionMessage({
    line,
    index,
    ...renderProps,
    nextLine,
  });
  if (!content) return null;

  const isAssistant = line.type === "assistant";
  const rawTimestamp = getLineTimestamp(line);
  const absoluteTimestamp = formatTimestamp(rawTimestamp);
  const timestampTitle = absoluteTimestamp;
  const wrapperClassName = [
    isAssistant ? "group/msg flex flex-col w-full" : "group relative",
    TURN_GAP_CLASS,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      key={`line-${index}`}
      id={`msg-${index}`}
      className={wrapperClassName}
      title={line.type !== "user" ? (timestampTitle ?? undefined) : undefined}
    >
      {content}
      {isAssistant && (
        <MessageToolbar
          line={line}
          index={index}
          {...(rawTimestamp ? { timestamp: rawTimestamp } : {})}
        />
      )}
    </div>
  );
}

/**
 * Hook returning a map of `tool_use_id` -> live failure info derived from
 * `PostToolUseFailure` SSE events for the given session. Empty when the
 * session has no in-flight failures or the JSONL has already caught up.
 */
function useLiveToolFailures(sessionId: string): Map<string, LiveToolFailure> {
  const { failedTools } = useClaudeEvents();
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

function GroupedToolCallEntry({
  lines,
  indices,
  sessionId,
  toolResultMap,
  subagentLookup,
}: {
  lines: SessionLine[];
  indices: number[];
  sessionId: string;
  toolResultMap: Map<string, ToolResultInfo>;
  subagentLookup: SubagentLookup;
}) {
  const liveFailures = useLiveToolFailures(sessionId);
  const allToolCalls = useMemo(
    () =>
      lines.flatMap((line) => {
        if (line.type !== "assistant") return [];
        const content = line.message?.content;
        if (!Array.isArray(content)) return [];
        return content
          .filter((b): b is ToolUseBlock => b.type === "tool_use")
          .map((block) =>
            buildClientToolCall(
              block,
              line.uuid ?? "",
              toolResultMap,
              liveFailures,
              subagentLookup,
            ),
          );
      }),
    [lines, toolResultMap, liveFailures, subagentLookup],
  );

  if (allToolCalls.length === 0) return null;

  const sourceSessionId = getSourceSessionId(lines[0]!, sessionId);

  return (
    <div id={`msg-${indices[0]}`} className={`group/msg flex flex-col w-full ${TURN_GAP_CLASS}`}>
      <ToolCallSection calls={allToolCalls} sessionId={sourceSessionId} />
    </div>
  );
}

const BANNER_LINE_TYPES = new Set([
  "agent-name",
  "agent-color",
  "permission-mode",
  "pr-link",
  "attachment",
  "system",
  "worktree",
]);

function isToolOnlyAssistantLine(line: SessionLine): boolean {
  if (line.type !== "assistant") return false;
  const content = line.message?.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every(
    (b) =>
      b.type === "tool_use" ||
      (b.type === "text" && (typeof b.text !== "string" || b.text.trim() === "")),
  );
}

function isToolResultOnlyUserLine(line: SessionLine): boolean {
  if (line.type !== "user") return false;
  const content = line.message?.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((b) => b.type === "tool_result");
}

function SessionLineList({
  lines,
  ...renderProps
}: LineRenderProps & {
  lines: SessionLine[];
}) {
  const skipSet = useMemo(() => buildSkipSet(lines), [lines]);

  const elements: React.ReactNode[] = [];
  let prevVisibleType: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (skipSet.has(i) || !isLineVisible(line, renderProps)) {
      i++;
      continue;
    }

    // Group consecutive tool-only assistant lines
    if (isToolOnlyAssistantLine(line) && renderProps.showTools) {
      const groupStart = i;
      const groupIndices: number[] = [i];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j]!;
        if (skipSet.has(j) || !isLineVisible(nextLine, renderProps)) {
          j++;
          continue;
        }
        if (isToolResultOnlyUserLine(nextLine)) {
          j++;
          continue;
        }
        if (isToolOnlyAssistantLine(nextLine)) {
          groupIndices.push(j);
          j++;
        } else {
          break;
        }
      }

      prevVisibleType = "assistant";

      if (groupIndices.length === 1) {
        elements.push(
          <LineEntry
            key={`line-${groupStart}`}
            line={line}
            index={groupStart}
            nextLine={lines[groupStart + 1]}
            {...renderProps}
          />,
        );
      } else {
        elements.push(
          <GroupedToolCallEntry
            key={`group-${groupStart}`}
            lines={groupIndices.map((idx) => lines[idx]!)}
            indices={groupIndices}
            {...renderProps}
          />,
        );
      }
      i = j;
      continue;
    }

    const isBannerAfterBanner =
      BANNER_LINE_TYPES.has(line.type) &&
      prevVisibleType !== null &&
      BANNER_LINE_TYPES.has(prevVisibleType);

    prevVisibleType = line.type;

    elements.push(
      <LineEntry
        key={`line-${i}`}
        line={line}
        index={i}
        nextLine={lines[i + 1]}
        {...(isBannerAfterBanner ? { className: "mt-1" } : {})}
        {...renderProps}
      />,
    );
    i++;
  }

  return <>{elements}</>;
}

const HOOK_WARNING_SUBTYPES = new Set(["hook_non_blocking_error", "hook_additional_context"]);
const HOOK_ERROR_SUBTYPES = new Set(["hook_cancelled", "hook_blocking_error"]);
const SYSTEM_BANNER_SUBTYPES = new Set([
  "skill_listing",
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
]);

function getAttachmentSubtype(json: string): string | null {
  try {
    return (JSON.parse(json) as { type?: string }).type ?? null;
  } catch {
    return null;
  }
}

/**
 * Check whether an assistant line has content that will render.
 * Returns false when all content blocks are empty text, hidden thinking,
 * or tool_use blocks with showTools off -- avoiding blank rows.
 */
function hasAssistantVisibleContent(
  line: SessionLine,
  showThinking: boolean,
  showTools: boolean,
): boolean {
  if (line.type !== "assistant") return true;
  const content = line.message?.content;
  if (!Array.isArray(content) || content.length === 0) return false;

  const hasText = content.some(
    (b) => b.type === "text" && typeof b.text === "string" && b.text.trim() !== "",
  );
  const hasThinking =
    showThinking &&
    content.some(
      (b) => b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim() !== "",
    );
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
): boolean {
  if (line.type === "agent-name" || line.type === "agent-color" || line.type === "permission-mode")
    return showSystemBanners;
  if (line.type === "worktree") return showSystemBanners;
  if (line.type === "system") {
    if (line.subtype === "stop_hook_summary") {
      const failed = (line.hookErrors?.length ?? 0) > 0 || line.preventedContinuation === true;
      return failed ? showHookErrors : showPassedHooks;
    }
    return showSystemBanners;
  }
  if (line.type === "attachment") {
    const subtype = getAttachmentSubtype(line.attachmentJson);
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
  index,
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
  index: number;
  nextLine?: SessionLine | undefined;
}) {
  const sourceSessionId = getSourceSessionId(line, sessionId);

  switch (line.type) {
    case "user":
      return (
        <UserEntry
          line={line}
          index={index}
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
      return (
        <Banner
          icon={<Palette className="h-3.5 w-3.5" />}
          label={`Agent color: ${line.agentColor}`}
        />
      );
    case "permission-mode":
      return (
        <Banner
          icon={<Lock className="h-3.5 w-3.5" />}
          label={`Permission mode: ${line.permissionMode}`}
        />
      );
    case "pr-link":
      return (
        <Banner icon={<Link className="h-3.5 w-3.5" />}>
          <a
            href={line.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-500 hover:underline"
          >
            {line.prRepository}#{line.prNumber}
          </a>
        </Banner>
      );
    case "attachment":
      return (
        <AttachmentBanner
          attachmentJson={line.attachmentJson}
          sessionId={sourceSessionId}
          uuid={line.uuid}
        />
      );
    case "system":
      return <SystemBanner line={line} sessionId={sourceSessionId} />;
    case "worktree":
      return (
        <Banner
          icon={<GitBranch className="h-3.5 w-3.5" />}
          label={`Worktree: ${line.worktreeName}`}
        >
          <span className="font-mono text-text-600" title={`main repo: ${line.originalCwd}`}>
            {line.originalBranch !== undefined && line.originalBranch !== line.worktreeBranch
              ? `${line.originalBranch} → ${line.worktreeBranch}`
              : line.worktreeBranch}
          </span>
          {line.originalHeadCommit !== undefined && (
            <span className="font-mono text-text-600" title={line.originalHeadCommit}>
              {line.originalHeadCommit.slice(0, 7)}
            </span>
          )}
          {line.enteredExisting === true && <span className="text-text-600">entered existing</span>}
        </Banner>
      );
    case "unparsed":
      return (
        <Banner
          icon={<FileWarning className="h-3.5 w-3.5" />}
          label={`Unreadable ${line.recordType ?? "record"}`}
        >
          <span className="font-mono text-text-600" title={line.issues.join("\n")}>
            {line.issues[0] ?? "did not match the transcript schema"}
          </span>
        </Banner>
      );
    default:
      return assertNever(line);
  }
}

function TruncatedContent({
  children,
  fadeColor,
  variant = "default",
}: {
  children: React.ReactNode;
  fadeColor?: string;
  variant?: "default" | "user";
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [showFull, setShowFull] = useState(false);

  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      contentRef.current = node;
      setIsTruncated(node.scrollHeight > 200);
    }
  }, []);

  if (showFull) {
    return <div className="overflow-hidden">{children}</div>;
  }

  return (
    <div>
      <div className="relative">
        <div ref={measureRef} className={isTruncated ? "max-h-[200px] overflow-hidden" : ""}>
          {children}
        </div>
        {isTruncated && (
          <button
            type="button"
            onClick={() => setShowFull(true)}
            aria-label="Show more"
            className="absolute inset-x-0 bottom-0 h-16 cursor-pointer"
            style={{
              background: `linear-gradient(to bottom, transparent, ${fadeColor ?? "var(--bg-100)"})`,
            }}
          />
        )}
      </div>
      {isTruncated && (
        <div className="mt-1 flex">
          <button
            type="button"
            onClick={() => setShowFull(true)}
            className={
              variant === "user"
                ? "text-xs font-medium cursor-pointer rounded-full px-2 py-0.5 bg-accent-100/15 text-user-msg-text"
                : "text-xs font-medium text-accent-100 hover:text-accent-000 cursor-pointer rounded-full bg-bg-200 px-2 py-0.5"
            }
          >
            Show more
          </button>
        </div>
      )}
    </div>
  );
}

type UserContentKind =
  | "command"
  | "bash"
  | "text"
  | "tool-result-only"
  | "request-interrupted"
  | "compact-summary"
  | "stop-hook"
  | "slash-command-body";

const REQUEST_INTERRUPTED_RE = /^\[Request interrupted by user.*\]\s*$/;

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
  if (text && REQUEST_INTERRUPTED_RE.test(text)) {
    return "request-interrupted";
  }

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
  index,
  sessionId,
  nextLine,
  isSubagentSession,
  showCompactSummaries,
  allowedImageRoots,
}: {
  line: MessageSessionLine;
  index: number;
  sessionId: string;
  nextLine?: SessionLine | undefined;
  isSubagentSession: boolean;
  showCompactSummaries: boolean;
  allowedImageRoots: readonly string[];
}) {
  const kind = classifyUserContent(line);

  if (line.isCompactSummary === true && !showCompactSummaries) {
    return (
      <CompactSummaryStub
        line={line}
        index={index}
        sessionId={sessionId}
        allowedImageRoots={allowedImageRoots}
      />
    );
  }

  if (kind === "command") {
    return <CommandEntry line={line} index={index} sessionId={sessionId} />;
  }

  if (kind === "bash") {
    const coalesceNext = hasBashInput(line) && nextLine?.type === "user" && hasBashOutput(nextLine);
    return (
      <BashEntry
        line={line}
        outputLine={coalesceNext ? nextLine : undefined}
        sessionId={sessionId}
      />
    );
  }

  if (kind === "tool-result-only") {
    return null;
  }

  if (isSubagentSession) {
    return <SubagentPromptEntry line={line} sessionId={sessionId} />;
  }

  if (kind in LABEL_BY_KIND) {
    const label = LABEL_BY_KIND[kind as LabeledKind];
    return (
      <LabeledAutomatedEntry
        line={line}
        index={index}
        sessionId={sessionId}
        label={label}
        allowedImageRoots={allowedImageRoots}
      />
    );
  }

  const timestamp = "timestamp" in line ? line.timestamp : undefined;
  const actionsProps = { line, index, ...(timestamp ? { timestamp } : {}) };
  const { textNodes, mediaNodes } = renderUserContentBlocks(line, sessionId, allowedImageRoots);

  return (
    <div className="group/msg flex justify-start w-full">
      <div className="flex flex-col items-start gap-1 max-w-[75%] min-w-0">
        {line.promptSource !== undefined && (
          <span className="text-[11px] text-text-500">
            {promptSourceLabels[line.promptSource]} prompt
            {line.queuePriority === "later" && " · queued for later"}
          </span>
        )}
        {textNodes.length > 0 && (
          <div className="user-message-bubble relative flex flex-col gap-[5px] rounded-[10px] bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body select-text">
            {textNodes}
          </div>
        )}
        {mediaNodes}
        <UserMessageActions {...actionsProps} />
      </div>
    </div>
  );
}

type LabeledKind = "request-interrupted" | "compact-summary" | "stop-hook" | "slash-command-body";

const LABEL_BY_KIND: Record<LabeledKind, string> = {
  "request-interrupted": "Request interrupted",
  "compact-summary": "Compact summary",
  "stop-hook": "Stop hook feedback",
  "slash-command-body": "Slash command body",
};

function getCompactSummarySizeKB(line: MessageSessionLine): number {
  const content = line.message?.content;
  if (!content) return 0;
  let bytes = 0;
  if (typeof content === "string") {
    bytes = content.length;
  } else {
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        bytes += block.text.length;
      }
    }
  }
  return Math.max(1, Math.round(bytes / 1024));
}

function CompactSummaryStub({
  line,
  index,
  sessionId,
  allowedImageRoots,
}: {
  line: MessageSessionLine;
  index: number;
  sessionId: string;
  allowedImageRoots: readonly string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const sizeKB = getCompactSummarySizeKB(line);

  if (expanded) {
    const timestamp = "timestamp" in line ? line.timestamp : undefined;
    const actionsProps = { line, index, ...(timestamp ? { timestamp } : {}) };
    const { textNodes, mediaNodes } = renderUserContentBlocks(line, sessionId, allowedImageRoots);

    return (
      <div className="group/msg flex justify-start w-full">
        <div className="flex flex-col items-start gap-1 max-w-[85%] min-w-0">
          <div className="flex items-center gap-1.5 px-1">
            <span className="text-[10px] font-medium text-text-500 bg-bg-200 rounded-full px-2 py-0.5">
              Compact summary
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[10px] text-text-500 hover:text-text-000 cursor-pointer"
            >
              Collapse
            </button>
          </div>
          {textNodes.length > 0 && (
            <div className="user-message-bubble relative flex flex-col gap-[5px] rounded-[10px] bg-auto-msg-bg text-auto-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body select-text">
              {textNodes}
            </div>
          )}
          {mediaNodes}
          <UserMessageActions {...actionsProps} />
        </div>
      </div>
    );
  }

  return (
    <div className="group/msg flex justify-start w-full">
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-bg-200 text-[11px] text-text-500 hover:text-text-000 cursor-pointer"
      >
        <span className="font-medium">Compact summary (~{sizeKB} KB)</span>
        <span>— click to expand</span>
      </button>
    </div>
  );
}

function LabeledAutomatedEntry({
  line,
  index,
  sessionId,
  label,
  allowedImageRoots,
}: {
  line: MessageSessionLine;
  index: number;
  sessionId: string;
  label: string;
  allowedImageRoots: readonly string[];
}) {
  const timestamp = "timestamp" in line ? line.timestamp : undefined;
  const actionsProps = { line, index, ...(timestamp ? { timestamp } : {}) };
  const { textNodes, mediaNodes } = renderUserContentBlocks(line, sessionId, allowedImageRoots);

  if (textNodes.length === 0 && mediaNodes.length === 0) return null;

  return (
    <div className="group/msg flex justify-start w-full">
      <div className="flex flex-col items-start gap-1 max-w-[85%] min-w-0">
        <div className="flex items-center gap-1.5 px-1">
          <span className="text-[10px] font-medium text-text-500 bg-bg-200 rounded-full px-2 py-0.5">
            {label}
          </span>
        </div>
        {textNodes.length > 0 && (
          <div className="user-message-bubble relative flex flex-col gap-[5px] rounded-[10px] bg-auto-msg-bg text-auto-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body select-text">
            {textNodes}
          </div>
        )}
        {mediaNodes}
        <UserMessageActions {...actionsProps} />
      </div>
    </div>
  );
}

function SubagentPromptEntry({ line, sessionId }: { line: MessageSessionLine; sessionId: string }) {
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
        <div className="text-body text-text-100">
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
    return content.some(
      (b) => b.type === "text" && typeof b.text === "string" && parser(b.text) !== null,
    );
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

function renderUserContentBlocks(
  line: MessageSessionLine,
  sessionId: string,
  allowedImageRoots: readonly string[],
): UserContentBlocks {
  const content = line.message?.content;
  if (!content) return { textNodes: [], mediaNodes: [] };

  if (typeof content === "string") {
    const cleaned = stripCommandTags(content);
    if (!cleaned) return { textNodes: [], mediaNodes: [] };
    return {
      textNodes: [
        <React.Fragment key={0}>
          <TruncatedContent fadeColor="var(--bg-100)" variant="user">
            <MarkdownArticle markdown={cleaned} />
          </TruncatedContent>
          <DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
        </React.Fragment>,
      ],
      mediaNodes: [
        <InlinePathImages key="path-images" text={cleaned} allowedRoots={allowedImageRoots} />,
      ],
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
          <TruncatedContent fadeColor="var(--bg-100)" variant="user">
            <MarkdownArticle markdown={cleaned} />
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
          className="relative rounded-lg px-3 py-2 bg-bg-100 text-text-000 flex items-center gap-1.5"
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
      <InlinePathImages
        key="path-images"
        text={inlineImageText.join("\n")}
        allowedRoots={allowedImageRoots}
      />,
    );
  }
  return { textNodes, mediaNodes };
}

function CommandEntry({
  line,
  index,
  sessionId,
}: {
  line: MessageSessionLine;
  index: number;
  sessionId: string;
}) {
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

  const displayName = cmdName.startsWith("/") ? cmdName : `/${cmdName}`;
  const commandText = cmdArgs ? `${displayName} ${cmdArgs}` : displayName;

  const timestamp = "timestamp" in line ? line.timestamp : undefined;
  const actionsProps = { line, index, ...(timestamp ? { timestamp } : {}) };

  return (
    <div className="group/msg flex justify-start w-full">
      <div className="flex flex-col items-start gap-1 max-w-[75%] min-w-0">
        <div className="user-message-bubble relative flex flex-col gap-[5px] rounded-[10px] bg-user-msg-bg text-user-msg-text px-3 py-2 break-words min-w-0 w-full overflow-hidden text-body select-text">
          <TruncatedContent fadeColor="var(--bg-100)" variant="user">
            <MarkdownArticle markdown={commandText} />
          </TruncatedContent>
          <DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
        </div>
        <UserMessageActions {...actionsProps} />
      </div>
    </div>
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
      <div className="relative rounded-lg p-2 bg-bg-100 text-text-000 max-w-[90%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] min-w-0">
        {command && (
          <div className="bg-bg-200 rounded px-2 py-1.5 font-mono text-xs flex items-start gap-2">
            <span className="text-text-500">! </span>
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
 * inline italic body type in the 50%-ink layer. `pr-6` reserves the gutter the
 * hover-revealed controls sit in.
 *
 * The group is named `body` rather than upstream's `thinking` so the shared
 * `CopyButton` hover reveal applies unchanged.
 */
function ThinkingBlock({
  thinking,
  sessionId,
  sourceUuid,
}: {
  thinking: string;
  sessionId: string;
  sourceUuid: string | undefined;
}) {
  return (
    <div className="group/body relative">
      <div className="text-body text-t6 italic whitespace-pre-wrap break-words pr-6">
        {thinking}
      </div>
      <div className="absolute right-0 top-0 flex items-center gap-g3">
        <DebugLink sessionId={sessionId} uuid={sourceUuid} />
        <CopyButton text={thinking} />
      </div>
    </div>
  );
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
  const content = line.message?.content;

  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }

  // Collect tool_use blocks for the tool summary and section
  const liveFailures = useLiveToolFailures(sessionId);
  const toolCalls = useMemo(
    () =>
      content
        .filter((b): b is ToolUseBlock => b.type === "tool_use")
        .map((block) =>
          buildClientToolCall(block, line.uuid ?? "", toolResultMap, liveFailures, subagentLookup),
        ),
    [content, line, toolResultMap, liveFailures, subagentLookup],
  );
  const hasVisibleNonToolContent = content.some(
    (b) =>
      (b.type === "text" && typeof b.text === "string" && b.text.trim() !== "") ||
      (b.type === "thinking" &&
        showThinking &&
        typeof b.thinking === "string" &&
        b.thinking.trim() !== "") ||
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
function AttributionRow({ line }: { line: MessageSessionLine }) {
  const skillLabel = line.attributionSkill ?? line.attributionPlugin;
  const mcpLabel = line.attributionMcpServer
    ? `${line.attributionMcpServer}${line.attributionMcpTool ? ` · ${line.attributionMcpTool}` : ""}`
    : undefined;
  if (!skillLabel && !mcpLabel) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {skillLabel && (
        <span className="inline-flex items-center gap-1 text-[11px] text-text-500 bg-bg-100 rounded-full px-2 py-0.5">
          <Zap className="h-3 w-3" />
          {skillLabel}
        </span>
      )}
      {mcpLabel && (
        <span className="inline-flex items-center gap-1 text-[11px] text-text-500 bg-bg-100 rounded-full px-2 py-0.5">
          <Plug className="h-3 w-3" />
          {mcpLabel}
        </span>
      )}
    </div>
  );
}

/** Error callout for assistant turns flagged as API error messages. */
function ApiErrorCallout({ line }: { line: MessageSessionLine }) {
  const details = line.errorDetails;
  const detailsText =
    details === undefined
      ? undefined
      : typeof details === "string"
        ? details
        : JSON.stringify(details, null, 2);
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
      <div className="relative min-w-0 text-body text-text-100">
        <MarkdownArticle markdown={block.text} />
        <DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-0 right-0" />
      </div>
    );
  }

  if (block.type === "thinking" && typeof block.thinking === "string") {
    if (!showThinking || !block.thinking.trim()) return null;
    return <ThinkingBlock thinking={block.thinking} sessionId={sessionId} sourceUuid={line.uuid} />;
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
          className="max-w-full max-h-96 rounded-lg border border-border-300/15 shadow-sm"
        />
        <DebugLink sessionId={sessionId} uuid={line.uuid} className="absolute top-1 right-1" />
      </div>
    );
  }

  if (block.type === "document" && block.source) {
    return (
      <div className="relative rounded-lg px-3 py-2 bg-bg-100 text-text-000 flex items-center gap-1.5">
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
 * Row label per tool: `past` for a call that succeeded, `failed` for the
 * "Failed to ..." form upstream swaps in when the call errored. A tool with no
 * `past` labels its successful rows some other way -- Bash past-tenses the
 * call's own description instead of prefixing a verb.
 */
const TOOL_VERBS: Record<string, { past?: string; failed: string }> = {
  Edit: { past: "Edited", failed: "Failed to edit" },
  MultiEdit: { past: "Edited", failed: "Failed to edit" },
  Write: { past: "Wrote", failed: "Failed to write" },
  Bash: { failed: "Failed to run" },
  Read: { past: "Read", failed: "Failed to read" },
  Grep: { past: "Searched", failed: "Failed to search" },
  Glob: { past: "Searched", failed: "Failed to search" },
  Agent: { past: "Ran agent", failed: "Failed to run agent" },
  WebFetch: { past: "Fetched", failed: "Failed to fetch" },
  WebSearch: { past: "Searched web", failed: "Failed to search web" },
  ToolSearch: { past: "Used ToolSearch", failed: "Failed to use ToolSearch" },
  Skill: { past: "Loaded skill", failed: "Failed to load skill" },
  TaskCreate: { past: "Created task", failed: "Failed to create task" },
  TaskUpdate: { past: "Updated task", failed: "Failed to update task" },
  TaskGet: { past: "Got task", failed: "Failed to get task" },
  TaskList: { past: "Listed tasks", failed: "Failed to list tasks" },
  TaskStop: { past: "Stopped task", failed: "Failed to stop task" },
  TodoWrite: { past: "Updated todos", failed: "Failed to update todos" },
  EnterPlanMode: { past: "Entered plan mode", failed: "Failed to enter plan mode" },
  ExitPlanMode: { past: "Presented plan", failed: "Failed to present plan" },
  CronCreate: { past: "Scheduled", failed: "Failed to schedule" },
};

function toolCallVerb(name: string): string {
  const past = TOOL_VERBS[name]?.past;
  if (past) return past;
  if (name.startsWith("mcp__")) return formatToolName(name);
  return name;
}

/**
 * Past-tense forms for verbs that don't take an -ed/-d suffix.
 */
const IRREGULAR_PAST_TENSE: Record<string, string> = {
  build: "built",
  cut: "cut",
  find: "found",
  get: "got",
  keep: "kept",
  leave: "left",
  make: "made",
  put: "put",
  read: "read",
  rerun: "reran",
  run: "ran",
  see: "saw",
  send: "sent",
  set: "set",
  show: "showed",
  split: "split",
  take: "took",
  tell: "told",
  write: "wrote",
};

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Past-tense a description's leading verb, the way upstream labels a Bash row:
 * "Check git status" -> "Checked git status", "See what's new" -> "Saw what's
 * new". Text that doesn't start with a word, or that is already past tense, is
 * left verbatim.
 */
function pastTense(description: string): string {
  const match = /^([A-Za-z]+)([\s\S]*)$/.exec(description);
  if (!match) return description;
  const word = match[1]!;
  const rest = match[2]!;
  const lower = word.toLowerCase();
  const irregular = IRREGULAR_PAST_TENSE[lower];
  if (irregular) return capitalizeFirst(irregular) + rest;
  if (lower.endsWith("ed")) return capitalizeFirst(lower) + rest;
  if (lower.endsWith("e")) return capitalizeFirst(`${lower}d`) + rest;
  if (/[^aeiou]y$/.test(lower)) return capitalizeFirst(`${lower.slice(0, -1)}ied`) + rest;
  return capitalizeFirst(`${lower}ed`) + rest;
}

function toolCallFailedVerb(name: string): string {
  const verbs = TOOL_VERBS[name];
  if (verbs) return verbs.failed;
  return `Failed to use ${toolCallVerb(name)}`;
}

/**
 * Upstream gives a Bash row a single label span holding the past-tensed
 * description ("Checked git status") rather than a "Ran" verb plus the
 * description; a call with no description falls back to its raw command.
 */
function bashRowLabel(call: ClientToolCall): string {
  const description = getToolDescription(call.name, call.input);
  return description === null ? call.param : pastTense(description);
}

function lowercaseFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Tools drawn in full rather than collapsed into a summary row. Their renderer
 * owns the card shell -- upstream draws a card once per body, so the wrapper
 * here stays a bare positioning context for the DebugLink.
 */
const PROMINENT_TOOLS = new Set(["AskUserQuestion"]);
const TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskStop"]);

function ToolCallSection({ calls, sessionId }: { calls: ClientToolCall[]; sessionId: string }) {
  const prominentCalls = calls.filter((c) => PROMINENT_TOOLS.has(c.name));
  const backgroundCalls = calls.filter((c) => !PROMINENT_TOOLS.has(c.name));

  return (
    <>
      {backgroundCalls.length === 1 && (
        <ToolCallRow call={backgroundCalls[0]!} sessionId={sessionId} />
      )}
      {backgroundCalls.length > 1 && (
        <ToolCallSummary calls={backgroundCalls} sessionId={sessionId} />
      )}
      {prominentCalls.map((call, i) => {
        const Renderer = getToolRenderer(call.name);
        return (
          <div key={`prominent-${i}`} className="relative">
            <Suspense fallback={null}>
              <Renderer toolCall={call} />
            </Suspense>
            <DebugLink
              sessionId={sessionId}
              uuid={call.sourceUuid}
              className="absolute top-1 right-1"
            />
          </div>
        );
      })}
    </>
  );
}

/**
 * Tools whose param is a file path -- shown as filename-only in mono/primary style.
 */
const FILE_PARAM_TOOLS = new Set(["Read", "Edit", "MultiEdit", "Write"]);

/**
 * Tools whose renderer body already displays the param (e.g. URL),
 * so we suppress it from the ToolCallRow header to avoid duplication.
 */
const RENDERER_HANDLES_PARAM = new Set([
  "ToolSearch",
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
 * Tools that show inline diff stats (+N -M) in the clickable row.
 */
const EDIT_TOOLS = new Set(["Edit", "MultiEdit"]);

/**
 * Compute diff stats from an Edit tool call's old_string / new_string input.
 */
function useEditDiffStats(call: ClientToolCall): { added: number; removed: number } | null {
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
    return { added, removed };
  }, [call.name, call.input]);
}

/**
 * Inline diff stats matching upstream claude.ai/code:
 *   span.inline-flex > span.flex.gap-g1 > span.text-extended-green "+N"
 *                                        > span.text-extended-pink  "-M"
 */
function InlineDiffStats({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) return null;
  return (
    <span className="inline-flex">
      <span className="flex gap-g1 items-center text-body shrink-0">
        {added > 0 && <span className="text-extended-green">+{added}</span>}
        {removed > 0 && <span className="text-extended-pink">-{removed}</span>}
      </span>
    </span>
  );
}

function ToolCallRow({
  call,
  sessionId,
  nested = false,
}: {
  call: ClientToolCall;
  sessionId: string;
  nested?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const { settings } = useSettings();
  const verbose = settings.verbosity === "verbose";
  const expandable = !NON_EXPANDING_TOOLS.has(call.name);
  const Renderer = getToolRenderer(call.name);
  const verb = toolCallVerb(call.name);
  const isFileParam = FILE_PARAM_TOOLS.has(call.name);
  const diffStats = useEditDiffStats(call);
  const isCardStyle = CARD_STYLE_TOOLS.has(call.name) && !nested;
  const isCodeCard = CODE_CARD_TOOLS.has(call.name);
  // An always-visible body needs `empty:hidden` so a renderer that draws
  // nothing (TodoWrite with no in-progress item) leaves no padded gap; a
  // collapsed disclosure hides its own empty body already.
  const bodyClass =
    (nested && ROW_BODY_TOOLS.has(call.name)
      ? "group/body relative flex w-full pt-p3"
      : "group/body relative flex w-full flex-col pt-p3") + (expandable ? "" : " empty:hidden");
  // Upstream recolors the whole label of a failed tool row, except a file path,
  // which stays primary.
  const labelClass = call.isError
    ? "text-extended-pink"
    : "text-assistant-secondary group-hover/tool:text-assistant-primary";
  // A failed call whose param is its own description reads as one phrase
  // ("Failed to install dependencies and build"), so upstream drops the verb
  // and the separate param span; every other failed row keeps both
  // ("Failed to edit" + "cache.ts").
  const failedDescription = call.isError ? getToolDescription(call.name, call.input) : null;
  const bashLabel = call.name === "Bash" && !call.isError ? bashRowLabel(call) : null;
  const label = call.isError
    ? failedDescription === null
      ? toolCallFailedVerb(call.name)
      : `Failed to ${lowercaseFirst(failedDescription)}`
    : (bashLabel ?? verb);
  // A label that is a whole phrase owns the row and truncates; a bare verb
  // keeps its width so the param beside it truncates instead.
  const isPhraseLabel = failedDescription !== null || bashLabel !== null;

  const displayParam =
    RENDERER_HANDLES_PARAM.has(call.name) || isPhraseLabel
      ? ""
      : isFileParam
        ? (call.param.split("/").pop() ?? call.param)
        : call.param;

  const rowLabel = (
    <>
      <span
        className={`${isPhraseLabel ? "truncate min-w-0" : "shrink-0"} text-body ${labelClass}`}
      >
        {label}
      </span>
      {displayParam && (
        <span
          className={`truncate min-w-0 ${isFileParam ? "text-code text-assistant-primary" : `text-body ${labelClass}`}`}
        >
          {displayParam}
        </span>
      )}
      {diffStats && <InlineDiffStats added={diffStats.added} removed={diffStats.removed} />}
    </>
  );

  const body = isCardStyle ? (
    <div className="group/body py-p6">
      <div
        className={`card-outline ${isCodeCard ? "code-card " : ""}rounded-r6 overflow-clip flex flex-col relative`}
      >
        <Suspense fallback={null}>
          <Renderer toolCall={call} verbose={verbose} />
        </Suspense>
        <DebugLink
          sessionId={sessionId}
          uuid={call.sourceUuid}
          className="absolute top-1 right-1"
        />
      </div>
    </div>
  ) : (
    <div className={bodyClass}>
      <Suspense fallback={null}>
        <Renderer toolCall={call} nested={nested} verbose={verbose} />
      </Suspense>
    </div>
  );

  if (!expandable) {
    return (
      <div className="flex flex-col w-full">
        <div className="relative group/tool flex self-start max-w-full items-center py-0 gap-g2 text-left">
          {rowLabel}
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        className="relative group/tool flex self-start max-w-full items-center py-0 gap-g2 text-left cursor-pointer hide-focus-ring rounded-r3"
      >
        {rowLabel}
        <span className="shrink-0 text-assistant-secondary group-hover/tool:text-assistant-primary">
          <ChevronIcon expanded={expanded} size={14} />
        </span>
      </div>
      <div id={bodyId} className={`grid ${expanded ? "grid-rows-expand" : "grid-rows-collapse"}`}>
        <div className="overflow-hidden">{body}</div>
      </div>
    </div>
  );
}

/**
 * Renders the structured summary as verb spans matching upstream claude.ai/code:
 *   <span class="text-body">{verb}</span>
 *   <span> {rest}</span>
 * with commas between segments; the color comes from the hover-aware wrapper.
 */
function SummarySpans({ segments }: { segments: SummarySegment[] }) {
  return (
    <>
      {segments.map((segment, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span>, </span>}
          <span className="text-body">{segment.verb}</span>
          <span> {segment.rest}</span>
        </React.Fragment>
      ))}
    </>
  );
}

function ToolCallSummary({ calls, sessionId }: { calls: ClientToolCall[]; sessionId: string }) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const taskCalls = calls.filter((c) => TASK_TOOLS.has(c.name));
  const hasTasksView = taskCalls.length >= 3;
  const displayCalls = hasTasksView ? calls.filter((c) => !TASK_TOOLS.has(c.name)) : calls;
  const segments = useMemo(() => summarizeToolCallsStructured(displayCalls), [displayCalls]);

  return (
    <div className="flex flex-col w-full">
      {hasTasksView && (
        <div className="mb-2">
          <TasksView toolCalls={calls} />
        </div>
      )}
      {displayCalls.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded(!expanded)}
            className="relative group/tool flex self-start max-w-full items-center py-0 gap-g1 text-left hide-focus-ring rounded-r3"
          >
            <span className="inline-flex items-center gap-g3 min-w-0 text-assistant-secondary group-hover/tool:text-assistant-primary">
              <span className="text-body truncate min-w-0">
                <SummarySpans segments={segments} />
              </span>
            </span>
            <span className="shrink-0 text-assistant-secondary group-hover/tool:text-assistant-primary">
              <ChevronIcon expanded={expanded} size={14} />
            </span>
          </button>
          <div
            id={bodyId}
            className={`grid ${expanded ? "grid-rows-expand" : "grid-rows-collapse"}`}
          >
            <div className="overflow-hidden">
              {/* Upstream separates the grouped rows with hairline dividers and
                  per-child padding inside one outlined card, not with gaps
                  between rows floating on a tinted panel. */}
              <div className="flex flex-col card-outline rounded-r6 overflow-clip mt-p6 divide-y divide-t3 [&>*]:px-p7 [&>*]:py-p6">
                {displayCalls.map((call, i) => (
                  <ToolCallRow key={i} call={call} sessionId={sessionId} nested />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
