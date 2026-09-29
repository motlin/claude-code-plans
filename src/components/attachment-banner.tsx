import React, { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Ban,
  Bot,
  Brain,
  Calendar,
  ChevronRight,
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
  Users,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";
import { assertNever } from "../lib/assert-never";
import type { z } from "zod";
import {
  AttachmentPayloadSchema,
  type AttachmentPayload,
  type RenderedRoleSchema,
} from "../lib/schemas";
import { formatTimestamp, formatRelativeTimestamp } from "../lib/timestamp-format";
import { DebugLink } from "./debug-link";
import { PlanLink } from "./plan-link";

/**
 * Renders a JSONL attachment record as a compact informational banner.
 * Each attachment sub-type gets a contextual icon and label.
 * Accepts JSON-serialized attachment to avoid TanStack serialization issues.
 */
export function AttachmentBanner({
  attachmentJson,
  sessionId,
  uuid,
  rendered,
  renderedInHumanTurn,
  renderedRole,
}: {
  attachmentJson: string;
  sessionId?: string | undefined;
  uuid?: string | undefined;
  /** The exact context text (usually a system-reminder) the attachment rendered. */
  rendered?: readonly string[] | undefined;
  renderedInHumanTurn?: readonly string[] | undefined;
  renderedRole?: RenderedRole | undefined;
}) {
  const attachment = useMemo<AttachmentPayload | null>(() => {
    const parsed = AttachmentPayloadSchema.safeParse(JSON.parse(attachmentJson));
    return parsed.success ? parsed.data : null;
  }, [attachmentJson]);

  if (!attachment) return null;

  const sections = [
    ...attachmentDetailSections(attachment),
    ...renderedSections(rendered, renderedInHumanTurn, renderedRole),
  ];
  const details = sections.length > 0 ? <DetailSections sections={sections} /> : undefined;

  return (
    <AttachmentContent
      attachment={attachment}
      sessionId={sessionId}
      uuid={uuid}
      details={details}
    />
  );
}

type RenderedRole = z.infer<typeof RenderedRoleSchema>;

interface DetailSection {
  label: string;
  body: React.ReactNode;
}

const RENDERED_ROLE_LABELS = {
  system: "System reminder",
  user: "Injected into user turn",
} satisfies Record<RenderedRole, string>;

function renderedSections(
  rendered: readonly string[] | undefined,
  renderedInHumanTurn: readonly string[] | undefined,
  renderedRole: RenderedRole | undefined,
): DetailSection[] {
  const sections: DetailSection[] = [];
  if (rendered && rendered.length > 0) {
    sections.push({
      label: RENDERED_ROLE_LABELS[renderedRole ?? "system"],
      body: rendered.map((text, i) => <Pre key={i}>{text}</Pre>),
    });
  }
  if (renderedInHumanTurn && renderedInHumanTurn.length > 0) {
    sections.push({
      label: "Rendered in human turn",
      body: renderedInHumanTurn.map((text, i) => <Pre key={i}>{text}</Pre>),
    });
  }
  return sections;
}

function linesSection(label: string, lines: (string | false | undefined)[]): DetailSection[] {
  const present = lines.filter((line): line is string => typeof line === "string");
  return present.length > 0 ? [{ label, body: <Pre>{present.join("\n")}</Pre> }] : [];
}

function textSection(label: string, text: string | undefined): DetailSection[] {
  return text ? [{ label, body: <Pre>{text}</Pre> }] : [];
}

function yesNo(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? "yes" : "no";
}

function labeled(label: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${label}: ${value}`;
}

/** Type-specific details for the context attachments injected into the model's turn. */
function attachmentDetailSections(attachment: AttachmentPayload): DetailSection[] {
  if (attachment.type === "environment") {
    const snap = attachment.snapshot;
    return [
      ...linesSection("Environment snapshot", [
        labeled("Working directory", snap?.workingDirectory),
        labeled("Worktree", yesNo(snap?.isWorktree)),
        labeled("Git repository", yesNo(snap?.isGitRepo)),
        labeled("Additional directories", snap?.additionalWorkingDirectories?.join(", ")),
        labeled("Platform", snap?.platform),
        labeled("Shell", snap?.shell),
        labeled("OS version", snap?.osVersion),
        labeled("Scratchpad", snap?.scratchpadDirectory),
      ]),
      ...linesSection(
        "Environment changes",
        (attachment.changes ?? []).map((change) =>
          [
            change.field,
            change.from !== undefined && `(was ${change.from})`,
            change.added?.length && `+${change.added.join(", +")}`,
            change.removed?.length && `-${change.removed.join(", -")}`,
          ]
            .filter((part): part is string => typeof part === "string")
            .join(" "),
        ),
      ),
    ];
  }
  if (attachment.type === "instructions") {
    const files = attachment.files ?? [];
    return [
      ...textSection("Reason", attachment.reason),
      ...(files.length > 0
        ? [
            {
              label: "Instruction files",
              body: files.map((file) => {
                const title = `${file.path}${file.type ? ` (${file.type})` : ""}`;
                return file.content ? (
                  <details key={file.path} className="mt-1">
                    <summary className="cursor-pointer font-mono text-[10px]">{title}</summary>
                    <Pre>{file.content}</Pre>
                  </details>
                ) : (
                  <div key={file.path} className="mt-1 font-mono text-[10px]">
                    {title}
                  </div>
                );
              }),
            },
          ]
        : []),
      ...linesSection("Removed", attachment.removed ?? []),
    ];
  }
  if (attachment.type === "model") {
    const id = attachment.identity;
    return [
      ...linesSection("Model identity", [
        labeled("Model ID", id?.modelId),
        labeled("Name", id?.marketingName),
        labeled("Knowledge cutoff", id?.knowledgeCutoff),
      ]),
      ...textSection("Model text", attachment.text),
    ];
  }
  if (attachment.type === "prompt_snapshot") {
    const tools = attachment.tools ?? [];
    const systemPrompt = attachment.systemPrompt ?? [];
    return [
      ...(tools.length > 0
        ? [
            {
              label: `Tools (${tools.length})`,
              body: <Pre>{tools.map((tool) => tool.name).join(", ")}</Pre>,
            },
          ]
        : []),
      ...(systemPrompt.length > 0
        ? [
            {
              label: `System prompt (${systemPrompt.length} block${systemPrompt.length === 1 ? "" : "s"})`,
              body: systemPrompt.map((block, i) => <Pre key={i}>{block}</Pre>),
            },
          ]
        : []),
      ...textSection("Host prompt", attachment.hostPrompt),
    ];
  }
  if (attachment.type === "agent_listing_delta") {
    const builtIn = attachment.builtInTypes ?? [];
    return [
      ...linesSection(
        "Added agents",
        attachment.addedLines?.length ? attachment.addedLines : (attachment.addedTypes ?? []),
      ),
      ...linesSection("Removed agents", attachment.removedTypes ?? []),
      ...(builtIn.length > 0
        ? [{ label: `Built-in agents (${builtIn.length})`, body: <Pre>{builtIn.join(", ")}</Pre> }]
        : []),
    ];
  }
  if (attachment.type === "fork_briefing") return textSection("Briefing", attachment.text);
  if (attachment.type === "output_style") {
    return textSection("Turn reminder", attachment.turnReminder);
  }
  if (attachment.type === "output_style_instructions") {
    return textSection("Style prompt", attachment.style?.prompt);
  }
  return [];
}

function DetailSections({ sections }: { sections: readonly DetailSection[] }) {
  return (
    <div className="flex flex-col gap-2">
      {sections.map((section, i) => (
        <section key={i} data-attachment-detail={section.label}>
          <div className="text-[10px] font-medium uppercase tracking-wide text-t6">
            {section.label}
          </div>
          <div data-detail-body="">{section.body}</div>
        </section>
      ))}
    </div>
  );
}

function AttachmentContent({
  attachment,
  sessionId,
  uuid,
  details,
}: {
  attachment: AttachmentPayload;
  sessionId?: string | undefined;
  uuid?: string | undefined;
  details?: React.ReactNode;
}) {
  const shared = { sessionId, uuid, details };
  switch (attachment.type) {
    // -- Hook results --
    case "hook_success":
      return (
        <Banner
          icon={<CircleCheck className="h-3.5 w-3.5" />}
          label={`Hook passed: ${attachment.hookName}`}
          {...shared}
        >
          {attachment.durationMs !== undefined && (
            <span className="text-t6">{attachment.durationMs}ms</span>
          )}
        </Banner>
      );
    case "hook_non_blocking_error":
      return (
        <Banner
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label={`Hook error (non-blocking): ${attachment.hookName}`}
          {...shared}
        >
          {attachment.stderr && <Pre>{attachment.stderr}</Pre>}
        </Banner>
      );
    case "hook_cancelled":
      return (
        <Banner
          icon={<Ban className="h-3.5 w-3.5" />}
          label={`Hook cancelled: ${attachment.hookName}`}
          {...shared}
        />
      );
    case "hook_additional_context":
      return (
        <Banner
          icon={<Paperclip className="h-3.5 w-3.5" />}
          label={`Hook context: ${attachment.hookName}`}
          {...shared}
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
          {...shared}
        >
          {blockingMessage && <span className="text-t6">{blockingMessage}</span>}
        </Banner>
      );
    }
    case "hook_system_message":
      return (
        <Banner
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          label={`Hook message: ${attachment.hookName}`}
          {...shared}
        >
          {typeof attachment.content === "string" && attachment.content.length > 0 && (
            <Pre>{attachment.content}</Pre>
          )}
        </Banner>
      );
    case "async_hook_response":
      return (
        <Banner
          icon={<CircleCheck className="h-3.5 w-3.5" />}
          label={`Async hook completed: ${attachment.hookName}`}
          {...shared}
        >
          {attachment.exitCode !== undefined && (
            <span className="text-t6">exit {attachment.exitCode}</span>
          )}
        </Banner>
      );

    // -- File context --
    case "file":
      return (
        <Banner
          icon={<FileText className="h-3.5 w-3.5" />}
          label={attachment.displayPath ?? attachment.filename}
          {...shared}
        />
      );
    case "already_read_file":
      return (
        <Banner
          icon={<FileText className="h-3.5 w-3.5" />}
          label={`Already read: ${attachment.displayPath ?? attachment.filename}`}
          {...shared}
        />
      );
    case "directory":
      return (
        <Banner
          icon={<Folder className="h-3.5 w-3.5" />}
          label={attachment.displayPath ?? attachment.path ?? "directory"}
          {...shared}
        />
      );
    case "compact_file_reference":
      return (
        <Banner
          icon={<FileText className="h-3.5 w-3.5" />}
          label={attachment.displayPath ?? attachment.filename ?? "file reference"}
          {...shared}
        />
      );
    case "read_truncation_notice":
      return (
        <Banner
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="Read output truncated"
          {...shared}
        >
          <Pre>{attachment.banner}</Pre>
        </Banner>
      );
    case "edited_text_file":
      return (
        <Banner
          icon={<Pencil className="h-3.5 w-3.5" />}
          label={`Edited: ${attachment.filename}`}
          {...shared}
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
          {...shared}
        />
      );
    }
    case "opened_file_in_ide":
      return (
        <Banner
          icon={<FolderOpen className="h-3.5 w-3.5" />}
          label={`Opened in IDE: ${attachment.filename ?? "file"}`}
          {...shared}
        />
      );

    // -- System info --
    case "date_change":
      return (
        <Banner
          icon={<Calendar className="h-3.5 w-3.5" />}
          label={attachment.newDate}
          {...shared}
        />
      );
    case "command_permissions":
      return (
        <Banner
          icon={<Key className="h-3.5 w-3.5" />}
          label={`Permissions${attachment.model ? ` (${attachment.model})` : ""}`}
          {...shared}
        >
          {attachment.allowedTools && attachment.allowedTools.length > 0 && (
            <span className="text-t6">{attachment.allowedTools.length} tools allowed</span>
          )}
        </Banner>
      );
    case "companion_intro":
      return (
        <Banner
          icon={<PawPrint className="h-3.5 w-3.5" />}
          label={[attachment.name, attachment.species].filter(Boolean).join(" the ") || "Companion"}
          {...shared}
        />
      );
    case "ultrathink_effort":
      return (
        <Banner
          icon={<Brain className="h-3.5 w-3.5" />}
          label={`Thinking effort: ${attachment.level ?? "unknown"}`}
          {...shared}
        />
      );

    // -- Plan/mode transitions --
    case "plan_mode": {
      return (
        <Banner icon={<ClipboardList className="h-3.5 w-3.5" />} label="Plan mode" {...shared}>
          {attachment.planFilePath && <PlanLink planFilePath={attachment.planFilePath} />}
        </Banner>
      );
    }
    case "plan_mode_exit":
      return (
        <Banner
          icon={<ClipboardList className="h-3.5 w-3.5" />}
          label="Exited plan mode"
          {...shared}
        />
      );
    case "plan_mode_reentry": {
      return (
        <Banner
          icon={<ClipboardList className="h-3.5 w-3.5" />}
          label="Re-entered plan mode"
          {...shared}
        >
          {attachment.planFilePath && <PlanLink planFilePath={attachment.planFilePath} />}
        </Banner>
      );
    }
    case "plan_file_reference": {
      return (
        <Banner icon={<ClipboardList className="h-3.5 w-3.5" />} label="Plan file" {...shared}>
          {attachment.planFilePath && <PlanLink planFilePath={attachment.planFilePath} />}
        </Banner>
      );
    }
    case "nested_memory":
      return (
        <Banner
          icon={<FileText className="h-3.5 w-3.5" />}
          label={`Memory: ${attachment.displayPath ?? attachment.path ?? "nested"}`}
          {...shared}
        />
      );
    case "auto_mode":
      return (
        <Banner
          icon={<Bot className="h-3.5 w-3.5" />}
          label={`Auto mode${attachment.reminderType ? `: ${attachment.reminderType}` : ""}`}
          {...shared}
        />
      );
    case "auto_mode_exit":
      return <Banner icon={<Bot className="h-3.5 w-3.5" />} label="Auto mode exited" {...shared} />;
    case "max_turns_reached":
      return (
        <Banner
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label={`Max turns reached${attachment.maxTurns !== undefined ? ` (${attachment.turnCount ?? "?"}/${attachment.maxTurns})` : ""}`}
          {...shared}
        />
      );
    case "workflow_keyword_request":
      return (
        <Banner
          icon={<Workflow className="h-3.5 w-3.5" />}
          label="Workflow keyword request"
          {...shared}
        />
      );
    case "team_context":
      return (
        <Banner
          icon={<Users className="h-3.5 w-3.5" />}
          label={`Team: ${attachment.agentName ?? attachment.agentId ?? "member"}${attachment.teamName ? ` (${attachment.teamName})` : ""}`}
          {...shared}
        >
          {attachment.taskListPath && (
            <Link
              to="/tasks"
              className="inline-flex items-center gap-1 text-accent-500 hover:underline"
              title={attachment.taskListPath}
            >
              <ClipboardList className="h-3 w-3" />
              View tasks
            </Link>
          )}
          {attachment.teamConfigPath && (
            <span className="truncate font-mono text-[10px] text-t6" title="Team config path">
              {attachment.teamConfigPath}
            </span>
          )}
        </Banner>
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
          {...shared}
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
          {...shared}
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
          {...shared}
        />
      );
    }
    case "skill_listing":
      return (
        <Banner
          icon={<Zap className="h-3.5 w-3.5" />}
          label={`Skills${attachment.skillCount !== undefined ? ` (${attachment.skillCount})` : ""}${attachment.isInitial ? " — initial" : ""}`}
          {...shared}
        />
      );
    case "dynamic_skill":
      return (
        <Banner
          icon={<Zap className="h-3.5 w-3.5" />}
          label={`Dynamic skills${attachment.skillNames?.length ? ` (${attachment.skillNames.length})` : ""}: ${attachment.displayPath ?? attachment.skillDir ?? "loaded"}`}
          {...shared}
        />
      );
    case "invoked_skills":
      return (
        <Banner
          icon={<Zap className="h-3.5 w-3.5" />}
          label={`Invoked ${attachment.skills?.length ?? 0} skill${(attachment.skills?.length ?? 0) === 1 ? "" : "s"}`}
          {...shared}
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
          {...shared}
        />
      );
    }
    case "total_tokens_reminder":
      return (
        <Banner
          icon={<Hourglass className="h-3.5 w-3.5" />}
          label="Token budget reminder"
          {...shared}
        >
          <Pre>{attachment.text}</Pre>
        </Banner>
      );
    case "task_status": {
      const completed = attachment.status === "completed";
      return (
        <Banner
          icon={
            completed ? (
              <CircleCheck className="h-3.5 w-3.5" />
            ) : (
              <Hourglass className="h-3.5 w-3.5" />
            )
          }
          label={`Task ${attachment.status}${attachment.description ? `: ${attachment.description}` : ""}`}
          {...shared}
        >
          <span className="text-t6">#{attachment.taskId}</span>
        </Banner>
      );
    }

    // -- Commands --
    case "queued_command": {
      const queuedRelative = formatRelativeTimestamp(attachment.timestamp);
      const queuedAbsolute = formatTimestamp(attachment.timestamp);
      return (
        <Banner icon={<Hourglass className="h-3.5 w-3.5" />} label="Queued command" {...shared}>
          {typeof attachment.prompt === "string" && attachment.prompt.length > 0 && (
            <span className="text-t6 truncate max-w-sm" title={attachment.prompt}>
              {attachment.prompt.length > 80
                ? `${attachment.prompt.slice(0, 80)}...`
                : attachment.prompt}
            </span>
          )}
          {queuedRelative && (
            <span className="text-t6" title={queuedAbsolute ?? undefined}>
              {queuedRelative}
            </span>
          )}
        </Banner>
      );
    }

    // -- Diagnostics --
    case "diagnostics":
      return (
        <Banner
          icon={<Microscope className="h-3.5 w-3.5" />}
          label={`Diagnostics${attachment.isNew ? " (new)" : ""}`}
          {...shared}
        >
          {attachment.files && attachment.files.length > 0 && (
            <span className="text-t6">
              {attachment.files.length} file
              {attachment.files.length === 1 ? "" : "s"}
            </span>
          )}
        </Banner>
      );
    // -- Context injected into the model's turn --
    case "date":
      return (
        <Banner
          icon={<Calendar className="h-3.5 w-3.5" />}
          label={`${attachment.changed ? "Date changed" : "Date"}${attachment.date ? `: ${attachment.date}` : ""}`}
          {...shared}
        />
      );
    case "environment":
      return (
        <Banner
          icon={<FolderOpen className="h-3.5 w-3.5" />}
          label={`Environment${attachment.snapshot?.workingDirectory ? `: ${attachment.snapshot.workingDirectory}` : attachment.changes?.length ? " update" : ""}`}
          {...shared}
        />
      );
    case "instructions":
      return (
        <Banner
          icon={<FileText className="h-3.5 w-3.5" />}
          label={`Instructions${attachment.files ? ` (${attachment.files.length} file${attachment.files.length === 1 ? "" : "s"})` : ""}`}
          {...shared}
        />
      );
    case "model":
      return (
        <Banner
          icon={<Bot className="h-3.5 w-3.5" />}
          label={`Model${attachment.identity?.marketingName ? `: ${attachment.identity.marketingName}` : ""}`}
          {...shared}
        />
      );
    case "output_style":
    case "output_style_instructions": {
      const style =
        typeof attachment.style === "string" ? attachment.style : attachment.style?.name;
      return (
        <Banner
          icon={<Pencil className="h-3.5 w-3.5" />}
          label={`Output style${style ? `: ${style}` : ""}`}
          {...shared}
        />
      );
    }
    case "session_context":
    case "credential_org":
    case "remote_session_change":
    case "fork_briefing":
      return (
        <Banner
          icon={<Paperclip className="h-3.5 w-3.5" />}
          label={CONTEXT_ATTACHMENT_LABELS[attachment.type]}
          {...shared}
        />
      );
    case "prompt_snapshot":
    case "deferred_tools_record":
      return (
        <Banner
          icon={<Wrench className="h-3.5 w-3.5" />}
          label={
            attachment.type === "prompt_snapshot"
              ? `Prompt snapshot${attachment.tools ? ` (${attachment.tools.length} tools)` : ""}`
              : `Deferred tools${attachment.entries ? ` (${attachment.entries.length})` : ""}`
          }
          {...shared}
        />
      );
    case "bash_output_audience_note":
    case "batching_reminder_sent":
    case "silent_turn_reminder":
      return (
        <Banner
          icon={<Pin className="h-3.5 w-3.5" />}
          label={CONTEXT_ATTACHMENT_LABELS[attachment.type]}
          {...shared}
        />
      );
    case "hook_permission_decision":
      return (
        <Banner
          icon={<Key className="h-3.5 w-3.5" />}
          label={`Permission hook${attachment.decision ? `: ${attachment.decision}` : ""}`}
          {...shared}
        />
      );
    case "thinking_drop":
    case "thinking_stripped":
      return (
        <Banner
          icon={<Brain className="h-3.5 w-3.5" />}
          label={
            attachment.type === "thinking_drop"
              ? `Thinking dropped${attachment.newlyDropped?.blockCount !== undefined ? ` (${attachment.newlyDropped.blockCount} blocks)` : ""}`
              : "Thinking stripped"
          }
          {...shared}
        />
      );
    default:
      return assertNever(attachment);
  }
}

const CONTEXT_ATTACHMENT_LABELS = {
  session_context: "Session context",
  credential_org: "Credential organization",
  remote_session_change: "Remote session attribution",
  fork_briefing: "Fork briefing",
  bash_output_audience_note: "Bash output audience note",
  batching_reminder_sent: "Batching reminder",
  silent_turn_reminder: "Silent turn reminder",
} satisfies Partial<Record<AttachmentPayload["type"], string>>;

/**
 * `pill` is the bordered, icon-led card upstream claude.ai/code reserves for
 * rows that expand into a body. `status` is its inline status line: no icon,
 * no background, no border, footnote type in the muted `t6` ink.
 */
export type BannerVariant = "pill" | "status";

export function Banner({
  icon,
  label,
  children,
  sessionId,
  uuid,
  variant = "pill",
  details,
}: {
  icon?: React.ReactNode;
  label?: string;
  children?: React.ReactNode;
  sessionId?: string | undefined;
  uuid?: string | undefined;
  variant?: BannerVariant;
  /** Expandable body; when present the pill becomes a disclosure. */
  details?: React.ReactNode | undefined;
}) {
  if (variant === "status") {
    return (
      <div className="flex items-center gap-1.5 min-w-0 text-footnote text-t6 select-none">
        {label && <span className="truncate min-w-0">{label}</span>}
        {children}
        {sessionId && <DebugLink sessionId={sessionId} uuid={uuid} className="ml-auto" />}
      </div>
    );
  }
  if (details !== undefined) {
    return (
      <details className="group text-xs text-t6 bg-surface-1 rounded-md border border-subtle">
        <summary className="flex flex-wrap items-center gap-2 py-1.5 px-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" />
          {icon && <span className="shrink-0">{icon}</span>}
          {label && <span>{label}</span>}
          {children}
          {sessionId && <DebugLink sessionId={sessionId} uuid={uuid} className="ml-auto" />}
        </summary>
        <div className="px-3 pb-2">{details}</div>
      </details>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5 px-3 text-xs text-t6 bg-surface-1 rounded-md border border-subtle">
      {icon && <span className="shrink-0">{icon}</span>}
      {label && <span>{label}</span>}
      {children}
      {sessionId && <DebugLink sessionId={sessionId} uuid={uuid} className="ml-auto" />}
    </div>
  );
}

export function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="w-full mt-1 text-[10px] leading-tight text-t6 bg-surface-0 rounded px-2 py-1 whitespace-pre-wrap break-all">
      {children}
    </pre>
  );
}
