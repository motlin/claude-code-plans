import React, { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Ban,
  Bot,
  Brain,
  Calendar,
  CircleCheck,
  ClipboardList,
  FileText,
  Folder,
  FolderOpen,
  Hourglass,
  Key,
  MessageSquare,
  Microscope,
  OctagonX,
  Paperclip,
  PawPrint,
  Pencil,
  Pin,
  Plug,
  Search,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";
import { assertNever } from "../lib/assert-never";
import { AttachmentPayloadSchema, type AttachmentPayload } from "../lib/schemas";
import { toMdSlug } from "../lib/md-slug";
import { DebugLink } from "./debug-link";

/**
 * Renders a JSONL attachment record as a compact informational banner.
 * Each attachment sub-type gets a contextual icon and label.
 * Accepts JSON-serialized attachment to avoid TanStack serialization issues.
 */
export function AttachmentBanner({
  attachmentJson,
  sessionId,
  uuid,
}: {
  attachmentJson: string;
  sessionId?: string | undefined;
  uuid?: string | undefined;
}) {
  const attachment = useMemo<AttachmentPayload | null>(() => {
    const parsed = AttachmentPayloadSchema.safeParse(JSON.parse(attachmentJson));
    return parsed.success ? parsed.data : null;
  }, [attachmentJson]);

  if (!attachment) return null;

  return <AttachmentContent attachment={attachment} sessionId={sessionId} uuid={uuid} />;
}

function AttachmentContent({
  attachment,
  sessionId,
  uuid,
}: {
  attachment: AttachmentPayload;
  sessionId?: string | undefined;
  uuid?: string | undefined;
}) {
  switch (attachment.type) {
    // -- Hook results --
    case "hook_success":
      return (
        <Banner
          icon={<CircleCheck className="h-3.5 w-3.5" />}
          label={`Hook passed: ${attachment.hookName}`}
          sessionId={sessionId}
          uuid={uuid}
        >
          {attachment.durationMs !== undefined && (
            <span className="text-text-600">{attachment.durationMs}ms</span>
          )}
        </Banner>
      );
    case "hook_non_blocking_error":
      return (
        <Banner
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label={`Hook error (non-blocking): ${attachment.hookName}`}
          sessionId={sessionId}
          uuid={uuid}
        >
          {attachment.stderr && <Pre>{attachment.stderr}</Pre>}
        </Banner>
      );
    case "hook_cancelled":
      return (
        <Banner
          icon={<Ban className="h-3.5 w-3.5" />}
          label={`Hook cancelled: ${attachment.hookName}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "hook_additional_context":
      return (
        <Banner
          icon={<Paperclip className="h-3.5 w-3.5" />}
          label={`Hook context: ${attachment.hookName}`}
          sessionId={sessionId}
          uuid={uuid}
        >
          {typeof attachment.content === "string" && attachment.content.length > 0 && (
            <Pre>{attachment.content}</Pre>
          )}
        </Banner>
      );
    case "hook_blocking_error": {
      const be = attachment.blockingError;
      const blockingMessage =
        be && typeof be["message"] === "string"
          ? be["message"]
          : be && typeof be["reason"] === "string"
            ? be["reason"]
            : undefined;
      return (
        <Banner
          icon={<OctagonX className="h-3.5 w-3.5" />}
          label={`Hook blocked: ${attachment.hookName}`}
          sessionId={sessionId}
          uuid={uuid}
        >
          {blockingMessage && <span className="text-text-600">{blockingMessage}</span>}
        </Banner>
      );
    }
    case "hook_system_message":
      return (
        <Banner
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          label={`Hook message: ${attachment.hookName}`}
          sessionId={sessionId}
          uuid={uuid}
        >
          {typeof attachment.content === "string" && attachment.content.length > 0 && (
            <Pre>{attachment.content}</Pre>
          )}
        </Banner>
      );

    // -- File context --
    case "file":
      return (
        <Banner
          icon={<FileText className="h-3.5 w-3.5" />}
          label={attachment.displayPath ?? attachment.filename}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "directory":
      return (
        <Banner
          icon={<Folder className="h-3.5 w-3.5" />}
          label={attachment.displayPath ?? attachment.path ?? "directory"}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "compact_file_reference":
      return (
        <Banner
          icon={<FileText className="h-3.5 w-3.5" />}
          label={attachment.displayPath ?? attachment.filename ?? "file reference"}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "edited_text_file":
      return (
        <Banner
          icon={<Pencil className="h-3.5 w-3.5" />}
          label={`Edited: ${attachment.filename}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "selected_lines_in_ide": {
      const filePart = attachment.displayPath ?? attachment.filename ?? "file";
      const linePart =
        attachment.lineStart !== undefined
          ? `:${attachment.lineStart}${attachment.lineEnd !== undefined ? `-${attachment.lineEnd}` : ""}`
          : "";
      return (
        <Banner
          icon={<Search className="h-3.5 w-3.5" />}
          label={`Selected in ${attachment.ideName ?? "IDE"}: ${filePart}${linePart}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    }
    case "opened_file_in_ide":
      return (
        <Banner
          icon={<FolderOpen className="h-3.5 w-3.5" />}
          label={`Opened in IDE: ${attachment.filename ?? "file"}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );

    // -- System info --
    case "date_change":
      return (
        <Banner
          icon={<Calendar className="h-3.5 w-3.5" />}
          label={attachment.newDate}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "command_permissions":
      return (
        <Banner
          icon={<Key className="h-3.5 w-3.5" />}
          label={`Permissions${attachment.model ? ` (${attachment.model})` : ""}`}
          sessionId={sessionId}
          uuid={uuid}
        >
          {attachment.allowedTools && attachment.allowedTools.length > 0 && (
            <span className="text-text-600">{attachment.allowedTools.length} tools allowed</span>
          )}
        </Banner>
      );
    case "companion_intro":
      return (
        <Banner
          icon={<PawPrint className="h-3.5 w-3.5" />}
          label={[attachment.name, attachment.species].filter(Boolean).join(" the ") || "Companion"}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "ultrathink_effort":
      return (
        <Banner
          icon={<Brain className="h-3.5 w-3.5" />}
          label={`Thinking effort: ${attachment.level ?? "unknown"}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );

    // -- Plan/mode transitions --
    case "plan_mode": {
      const planFilename = attachment.planFilePath?.split("/").pop();
      return (
        <Banner
          icon={<ClipboardList className="h-3.5 w-3.5" />}
          label="Plan mode"
          sessionId={sessionId}
          uuid={uuid}
        >
          {planFilename && (
            <Link
              to="/plan/$filename"
              params={{ filename: toMdSlug(planFilename) }}
              className="font-mono text-accent-500 hover:underline truncate max-w-xs"
              title={attachment.planFilePath}
            >
              {planFilename}
            </Link>
          )}
        </Banner>
      );
    }
    case "plan_mode_exit":
      return (
        <Banner
          icon={<ClipboardList className="h-3.5 w-3.5" />}
          label="Exited plan mode"
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "plan_mode_reentry": {
      const planFilename = attachment.planFilePath?.split("/").pop();
      return (
        <Banner
          icon={<ClipboardList className="h-3.5 w-3.5" />}
          label="Re-entered plan mode"
          sessionId={sessionId}
          uuid={uuid}
        >
          {planFilename && (
            <Link
              to="/plan/$filename"
              params={{ filename: toMdSlug(planFilename) }}
              className="font-mono text-accent-500 hover:underline truncate max-w-xs"
              title={attachment.planFilePath}
            >
              {planFilename}
            </Link>
          )}
        </Banner>
      );
    }
    case "plan_file_reference": {
      const planFilename = attachment.planFilePath?.split("/").pop();
      return (
        <Banner
          icon={<ClipboardList className="h-3.5 w-3.5" />}
          label="Plan file"
          sessionId={sessionId}
          uuid={uuid}
        >
          {planFilename && (
            <Link
              to="/plan/$filename"
              params={{ filename: toMdSlug(planFilename) }}
              className="font-mono text-accent-500 hover:underline truncate max-w-xs"
              title={attachment.planFilePath}
            >
              {planFilename}
            </Link>
          )}
        </Banner>
      );
    }
    case "nested_memory":
      return (
        <Banner
          icon={<FileText className="h-3.5 w-3.5" />}
          label={`Memory: ${attachment.displayPath ?? attachment.path ?? "nested"}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "auto_mode":
      return (
        <Banner
          icon={<Bot className="h-3.5 w-3.5" />}
          label={`Auto mode${attachment.reminderType ? `: ${attachment.reminderType}` : ""}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "auto_mode_exit":
      return (
        <Banner
          icon={<Bot className="h-3.5 w-3.5" />}
          label="Auto mode exited"
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "max_turns_reached":
      return (
        <Banner
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label={`Max turns reached${attachment.maxTurns !== undefined ? ` (${attachment.turnCount ?? "?"}/${attachment.maxTurns})` : ""}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "workflow_keyword_request":
      return (
        <Banner
          icon={<Workflow className="h-3.5 w-3.5" />}
          label="Workflow keyword request"
          sessionId={sessionId}
          uuid={uuid}
        />
      );

    // -- Tool/MCP ecosystem --
    case "deferred_tools_delta": {
      const parts: string[] = [];
      if (attachment.addedNames?.length) parts.push(`+${attachment.addedNames.length} tools`);
      if (attachment.removedNames?.length) parts.push(`-${attachment.removedNames.length} tools`);
      if (attachment.pendingMcpServers?.length) {
        const n = attachment.pendingMcpServers.length;
        parts.push(`${n} MCP server${n === 1 ? "" : "s"} pending`);
      }
      return (
        <Banner
          icon={<Wrench className="h-3.5 w-3.5" />}
          label={`Deferred tools: ${parts.join(", ") || "updated"}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    }
    case "agent_listing_delta": {
      const parts: string[] = [];
      if (attachment.addedTypes?.length) parts.push(`+${attachment.addedTypes.length} agents`);
      if (attachment.removedTypes?.length) parts.push(`-${attachment.removedTypes.length} agents`);
      return (
        <Banner
          icon={<Bot className="h-3.5 w-3.5" />}
          label={`Agents${attachment.isInitial ? " — initial" : ""}: ${parts.join(", ") || "updated"}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    }
    case "mcp_instructions_delta": {
      const parts: string[] = [];
      if (attachment.addedNames?.length) parts.push(`+${attachment.addedNames.length}`);
      if (attachment.removedNames?.length) parts.push(`-${attachment.removedNames.length}`);
      return (
        <Banner
          icon={<Plug className="h-3.5 w-3.5" />}
          label={`MCP instructions: ${parts.join(", ") || "updated"}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    }
    case "skill_listing":
      return (
        <Banner
          icon={<Zap className="h-3.5 w-3.5" />}
          label={`Skills${attachment.skillCount !== undefined ? ` (${attachment.skillCount})` : ""}${attachment.isInitial ? " — initial" : ""}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    case "invoked_skills":
      return (
        <Banner
          icon={<Zap className="h-3.5 w-3.5" />}
          label={`Invoked ${attachment.skills?.length ?? 0} skill${(attachment.skills?.length ?? 0) === 1 ? "" : "s"}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );

    // -- Reminders --
    case "task_reminder":
    case "todo_reminder": {
      const kind = attachment.type === "task_reminder" ? "Task" : "Todo";
      return (
        <Banner
          icon={<Pin className="h-3.5 w-3.5" />}
          label={`${kind} reminder${attachment.itemCount !== undefined ? ` (${attachment.itemCount} items)` : ""}`}
          sessionId={sessionId}
          uuid={uuid}
        />
      );
    }

    // -- Commands --
    case "queued_command":
      return (
        <Banner
          icon={<Hourglass className="h-3.5 w-3.5" />}
          label="Queued command"
          sessionId={sessionId}
          uuid={uuid}
        >
          {typeof attachment.prompt === "string" && attachment.prompt.length > 0 && (
            <span className="text-text-600 truncate max-w-sm" title={attachment.prompt}>
              {attachment.prompt.length > 80
                ? `${attachment.prompt.slice(0, 80)}...`
                : attachment.prompt}
            </span>
          )}
        </Banner>
      );

    // -- Diagnostics --
    case "diagnostics":
      return (
        <Banner
          icon={<Microscope className="h-3.5 w-3.5" />}
          label={`Diagnostics${attachment.isNew ? " (new)" : ""}`}
          sessionId={sessionId}
          uuid={uuid}
        >
          {attachment.files && attachment.files.length > 0 && (
            <span className="text-text-600">
              {attachment.files.length} file
              {attachment.files.length === 1 ? "" : "s"}
            </span>
          )}
        </Banner>
      );
    default:
      return assertNever(attachment);
  }
}

export function Banner({
  icon,
  label,
  children,
  sessionId,
  uuid,
}: {
  icon: React.ReactNode;
  label?: string;
  children?: React.ReactNode;
  sessionId?: string | undefined;
  uuid?: string | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5 px-3 text-xs text-text-500 bg-bg-100 rounded-md border border-border-300/10">
      <span className="shrink-0">{icon}</span>
      {label && <span>{label}</span>}
      {children}
      {sessionId && <DebugLink sessionId={sessionId} uuid={uuid} className="ml-auto" />}
    </div>
  );
}

export function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="w-full mt-1 text-[10px] leading-tight text-text-600 bg-bg-200 rounded px-2 py-1 whitespace-pre-wrap break-all">
      {children}
    </pre>
  );
}
