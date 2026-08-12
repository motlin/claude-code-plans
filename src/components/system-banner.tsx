import { Webhook } from "lucide-react";
import { assertNever } from "../lib/assert-never";
import type { ProcessedLine } from "../lib/transcript";
import { Banner, Pre } from "./attachment-banner";
import { CollapsibleSection } from "./tool-renderers/shared";

type SystemLine = Extract<ProcessedLine, { type: "system" }>;

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Headline for the error union (string, or a record with formatted/message). */
function errorHeadline(error: SystemLine["error"]): string | undefined {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const formatted = error["formatted"];
    if (typeof formatted === "string") return formatted;
    const message = error["message"];
    if (typeof message === "string") return message;
  }
  return undefined;
}

function jsonText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/**
 * Renders a system JSONL record (compact_boundary, stop_hook_summary,
 * api_error, turn_duration) as a compact informational banner, mirroring
 * the visual language of AttachmentBanner.
 */
export function SystemBanner({
  line,
  sessionId,
}: {
  line: SystemLine;
  sessionId?: string | undefined;
}) {
  switch (line.subtype) {
    case "compact_boundary": {
      const meta = line.compactMetadata;
      const preserved = meta?.preservedMessages;
      const segment = meta?.preservedSegment;
      return (
        <Banner
          variant="status"
          label={line.content ?? "Conversation compacted"}
          sessionId={sessionId}
          uuid={line.uuid}
        >
          {meta && (
            <span className="truncate min-w-0">
              {meta.trigger === "auto" ? "auto" : "manual"}
              {" · "}
              {formatTokens(meta.preTokens)}
              {meta.postTokens !== undefined && ` → ${formatTokens(meta.postTokens)} tokens`}
              {meta.durationMs !== undefined && ` · ${formatMs(meta.durationMs)}`}
              {preserved &&
                ` · ${preserved.uuids.length}/${preserved.allUuids.length} messages preserved`}
            </span>
          )}
          {segment && (
            <span className="font-mono truncate min-w-0">
              head {segment.headUuid.slice(0, 8)} · anchor {segment.anchorUuid.slice(0, 8)} · tail{" "}
              {segment.tailUuid.slice(0, 8)}
            </span>
          )}
        </Banner>
      );
    }
    case "stop_hook_summary": {
      const errorCount = line.hookErrors?.length ?? 0;
      const contextCount = line.hookAdditionalContext?.length ?? 0;
      return (
        <Banner
          icon={<Webhook className="h-3.5 w-3.5" />}
          label={`${line.hookCount ?? 0} stop hooks ran`}
          sessionId={sessionId}
          uuid={line.uuid}
        >
          {errorCount > 0 && (
            <span className="text-danger-000">
              {errorCount} error{errorCount === 1 ? "" : "s"}
            </span>
          )}
          {line.preventedContinuation === true && (
            <span className="text-danger-000">blocked continuation</span>
          )}
          {contextCount > 0 && (
            <span className="text-text-600">
              {contextCount} context item{contextCount === 1 ? "" : "s"}
            </span>
          )}
          {(errorCount > 0 || (line.hookInfos?.length ?? 0) > 0) && (
            <div className="basis-full">
              <CollapsibleSection label="Details">
                {line.hookErrors?.map((err, i) => (
                  <Pre key={`err-${i}`}>{jsonText(err)}</Pre>
                ))}
                {line.hookInfos?.map((info, i) => (
                  <Pre key={`info-${i}`}>{jsonText(info)}</Pre>
                ))}
              </CollapsibleSection>
            </div>
          )}
        </Banner>
      );
    }
    case "api_error":
      return (
        <Banner
          variant="status"
          label={errorHeadline(line.error) ?? "API error"}
          sessionId={sessionId}
          uuid={line.uuid}
        >
          {line.retryAttempt !== undefined && line.maxRetries !== undefined && (
            <span className="shrink-0">
              retry {line.retryAttempt}/{line.maxRetries}
            </span>
          )}
          {line.retryInMs !== undefined && (
            <span className="shrink-0">in {formatMs(line.retryInMs)}</span>
          )}
        </Banner>
      );
    case "turn_duration":
      return (
        <Banner
          variant="status"
          label={
            line.durationMs !== undefined
              ? `Turn took ${formatMs(line.durationMs)}`
              : "Turn finished"
          }
          sessionId={sessionId}
          uuid={line.uuid}
        >
          {line.pendingBackgroundAgentCount !== undefined &&
            line.pendingBackgroundAgentCount > 0 && (
              <span className="shrink-0">
                {line.pendingBackgroundAgentCount} background agent
                {line.pendingBackgroundAgentCount === 1 ? "" : "s"} pending
              </span>
            )}
        </Banner>
      );
    default:
      return assertNever(line.subtype);
  }
}
