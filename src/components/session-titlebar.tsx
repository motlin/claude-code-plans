import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AppWindow,
  ArrowLeft,
  Bot,
  ChevronDown,
  Cpu,
  FolderGit2,
  GitFork,
  Tag,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useSessionRename } from "../hooks/use-session-rename";
import { herdrPanesQueryOptions } from "../lib/api/herdr";
import {
  openSessionInFinder,
  sessionOpenInQueryOptions,
  type SessionDetailData,
} from "../lib/api/sessions";
import { writeClipboardText } from "../lib/clipboard";
import { formatModelName } from "../lib/model-name";
import { pin, unpin, usePins } from "../lib/pin-store";
import { forkDisabledReason } from "../lib/session-fork";
import { getSessionMenuItems, type SessionMenuSession } from "../lib/session-menu-items";
import { ArchivedBadge } from "./archived-badge";
import {
  MenuEntries,
  SESSION_MENU_CAPABILITIES,
  useRenameAfterMenuClose,
  useSessionMenuRunner,
} from "./session-actions-menu";
import { SessionTitleButton, useSessionTitleShortcuts } from "./session-title-heading";
import { TitlebarWidthContext } from "./titlebar-width";
import { useToast } from "./toast";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./ui/menu";
import { Tooltip } from "./ui/tooltip";

/** Below this titlebar width the origin pills collapse to icons, like upstream's `data-pills-compact`. */
const PILLS_COMPACT_BELOW_PX = 640;

const TITLE_CLASS =
  "h-[26px] min-w-0 cursor-text truncate rounded-r5 border-0 bg-transparent px-1.5 text-left text-body font-medium text-primary select-none hover:bg-fill-ghost-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100";

const CHEVRON_CLASS =
  "flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 data-[popup-open]:bg-fill-ghost-hover";

const PILL_CLASS =
  "inline-flex h-5 min-w-0 shrink-0 cursor-default items-center gap-[3px] rounded-r3 bg-alpha-2 px-[5px] text-caption text-secondary no-underline select-none transition-colors hover:bg-alpha-3 data-[popup-open]:bg-alpha-3";

/** `https://github.com/owner/repo` from the session's `pr-link`, the one remote URL the index knows. */
function repositoryUrl(pr: SessionDetailData["pr"]): string | null {
  if (pr === undefined) return null;
  try {
    return `${new URL(pr.url).origin}/${pr.repository}`;
  } catch {
    return null;
  }
}

type Toast = ReturnType<typeof useToast>;

async function copyWithToast(toast: Toast, text: string, what: string): Promise<void> {
  const copied = await writeClipboardText(text);
  toast(
    copied
      ? { kind: "success", message: `${what} copied to clipboard.` }
      : { kind: "error", message: `Couldn’t copy the ${what.toLowerCase()}. Try again.` },
  );
}

function downloadUrl(href: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = "";
  anchor.click();
}

/** The titlebar's width, which collapses the origin pills and folds the trail's pane toggles. */
function useTitlebarMeasure() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width, compact: width !== null && width < PILLS_COMPACT_BELOW_PX };
}

type PillIcon = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** Icon + label; the label turns sr-only when the titlebar is narrow. */
function PillContent({
  icon: Icon,
  label,
  compact,
}: {
  icon: PillIcon;
  label: string;
  compact: boolean;
}) {
  return (
    <>
      {compact && <Icon aria-hidden className="size-3 shrink-0" />}
      <span data-origin-label="" className={compact ? "sr-only" : "truncate"}>
        {label}
      </span>
    </>
  );
}

function OriginPill({
  kind,
  icon,
  label,
  title,
  compact,
}: {
  kind: string;
  icon: PillIcon;
  label: string;
  title?: string;
  compact: boolean;
}) {
  return (
    <span data-origin-pill={kind} title={title ?? label} className={PILL_CLASS}>
      <PillContent icon={icon} label={label} compact={compact} />
    </span>
  );
}

function ProjectPill({
  sessionId,
  data,
  compact,
}: {
  sessionId: string;
  data: SessionDetailData;
  compact: boolean;
}) {
  const toast = useToast();
  const path = data.projectPath ?? data.cwd;
  const repository = repositoryUrl(data.pr);

  const copy = (text: string, what: string) => copyWithToast(toast, text, what);

  return (
    <Menu>
      <MenuTrigger
        data-origin-pill="project"
        title={path ?? data.projectName}
        className={PILL_CLASS}
      >
        <PillContent icon={FolderGit2} label={data.projectName} compact={compact} />
      </MenuTrigger>
      <MenuContent>
        {path !== null && (
          <MenuItem
            onSelect={() => {
              openSessionInFinder(sessionId).catch(() => {
                toast({ kind: "error", message: "Couldn’t open the folder in Finder." });
              });
            }}
          >
            Open in Finder
          </MenuItem>
        )}
        {path !== null && <MenuItem onSelect={() => void copy(path, "Path")}>Copy path</MenuItem>}
        {data.gitBranch !== null && (
          <MenuItem onSelect={() => void copy(data.gitBranch ?? "", "Branch name")}>
            Copy branch name
          </MenuItem>
        )}
        {repository !== null && (
          <MenuItem onSelect={() => window.open(repository, "_blank", "noopener,noreferrer")}>
            Open repository on GitHub
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}

/** Local-only session actions, offered in the header menu after upstream's items. */
export interface SessionHeaderLocalActions {
  resumeCommand: string;
  forkCommand: string;
  reviewed: boolean;
  onToggleReviewed: () => Promise<unknown>;
  /** Absent when there is nothing to generate: a summary exists or the setting hides it. */
  onGenerateSummary?: (() => void) | undefined;
  generatingSummary?: boolean;
}

function HeaderLocalSection({
  sessionId,
  pinned,
  hasLivePane,
  local,
}: {
  sessionId: string;
  pinned: boolean;
  hasLivePane: boolean;
  local: SessionHeaderLocalActions;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const reviewLabel = local.reviewed ? "unreviewed" : "reviewed";
  const toggleReviewed = () => {
    local.onToggleReviewed().catch(() => {
      toast({ kind: "error", message: `Couldn’t mark the session ${reviewLabel}. Try again.` });
    });
  };
  return (
    <>
      <MenuSeparator />
      <MenuItem onSelect={() => void copyWithToast(toast, sessionId, "Session ID")}>
        Copy session ID
      </MenuItem>
      <MenuItem onSelect={() => void copyWithToast(toast, local.resumeCommand, "Resume command")}>
        Copy resume command
      </MenuItem>
      <MenuItem onSelect={() => void copyWithToast(toast, local.forkCommand, "Fork command")}>
        Copy fork command
      </MenuItem>
      <MenuItem onSelect={() => downloadUrl(`/api/raw?sessionId=${sessionId}`)}>
        Download raw JSONL
      </MenuItem>
      <MenuItem onSelect={() => (pinned ? unpin(sessionId) : pin(sessionId))}>
        {pinned ? "Unpin" : "Pin"}
      </MenuItem>
      <MenuItem onSelect={toggleReviewed}>{`Mark ${reviewLabel}`}</MenuItem>
      {hasLivePane && (
        <MenuItem
          onSelect={() =>
            void navigate({ to: "/herdr/terminal/$sessionId", params: { sessionId } })
          }
        >
          Open live terminal
        </MenuItem>
      )}
      {local.onGenerateSummary !== undefined &&
        (local.generatingSummary === true ? (
          <MenuItem disabled>Generating summary…</MenuItem>
        ) : (
          <MenuItem onSelect={local.onGenerateSummary}>Generate AI summary</MenuItem>
        ))}
    </>
  );
}

/** Mounted only while the chevron menu is open, so a closed menu never queries. */
function HeaderMenuBody({
  sessionId,
  data,
  title,
  isActive,
  requestRename,
  local,
}: {
  sessionId: string;
  data: SessionDetailData;
  title: string;
  isActive: boolean;
  requestRename: () => void;
  local: SessionHeaderLocalActions | undefined;
}) {
  const { data: herdr } = useQuery(herdrPanesQueryOptions);
  const { data: openIn } = useQuery(sessionOpenInQueryOptions(sessionId));
  const pins = usePins();
  const cwd = openIn?.cwd ?? data.cwd ?? data.projectPath;
  const bridgeSessionId = openIn?.bridgeSessionId ?? null;
  const prUrl = data.pr?.url ?? null;
  const pinned = pins.isPinned(sessionId);
  const hasLivePane = herdr?.panes.some((pane) => pane.sessionId === sessionId) ?? false;
  const menuSession: SessionMenuSession = {
    title,
    pinned,
    readState: "read",
    archived: data.archived,
    prUrl,
    hasLivePane,
    forkDisabledReason: forkDisabledReason({ working: isActive, cwd }),
    cwd,
    bridgeSessionId,
  };
  const run = useSessionMenuRunner({ sessionId, cwd, bridgeSessionId, prUrl, requestRename });
  return (
    <>
      <MenuEntries
        entries={getSessionMenuItems(menuSession, SESSION_MENU_CAPABILITIES, { surface: "header" })}
        run={run}
      />
      {local !== undefined && (
        <HeaderLocalSection
          sessionId={sessionId}
          pinned={pinned}
          hasLivePane={hasLivePane}
          local={local}
        />
      )}
    </>
  );
}

export interface SessionTitlebarProps {
  sessionId: string;
  data: SessionDetailData;
  isActive: boolean;
  /** Main pane toggles, e.g. Changes. */
  paneToggles?: ReactNode;
  /** Local-only actions for the header menu's trailing section. */
  local?: SessionHeaderLocalActions;
  /** The trailing View options menu trigger. */
  viewOptions?: ReactNode;
  /** The AI summary, shown as the title button's tooltip and description. */
  summary?: string | null;
  /** Subagent counts for the compact "N subagents" pill; hidden when there are none. */
  subagents?: { total: number; running: number };
}

function SubagentsPill({
  sessionId,
  total,
  running,
  compact,
}: {
  sessionId: string;
  total: number;
  running: number;
  compact: boolean;
}) {
  const count = Math.max(total, running);
  if (count === 0) return null;
  const label = `${count} subagent${count === 1 ? "" : "s"}${running > 0 ? ` · ${running} running` : ""}`;
  return (
    <Link
      to="/session/$id/subagents"
      params={{ id: sessionId }}
      data-origin-pill="subagents"
      title={label}
      className={`${PILL_CLASS} cursor-pointer`}
    >
      <PillContent icon={GitFork} label={label} compact={compact} />
    </Link>
  );
}

/**
 * claude.ai/code's 32px session titlebar. Lead: the parent-session back pill
 * (subagent transcripts only), the rename title button, the chevron header
 * menu and the origin pills (project menu plus local badges), which collapse
 * to icons when narrow. Trail: pane toggles, then View options.
 */
export function SessionTitlebar({
  sessionId,
  data,
  isActive,
  paneToggles,
  local,
  viewOptions,
  summary = null,
  subagents,
}: SessionTitlebarProps) {
  const rename = useSessionRename(sessionId, data.title);
  const cwd = data.cwd ?? data.projectPath;
  useSessionTitleShortcuts({
    sessionId,
    archived: data.archived,
    prUrl: data.pr?.url,
    cwd,
    startEditing: rename.startEditing,
  });
  const menuRename = useRenameAfterMenuClose(rename.startEditing);
  const { ref, width, compact } = useTitlebarMeasure();
  const modelLabel = formatModelName(data.model);

  return (
    <div
      ref={ref}
      data-testid="session-titlebar"
      data-perf-region="header"
      className="relative flex h-8 min-w-0 items-center"
    >
      <div
        data-titlebar-lead=""
        {...(compact ? { "data-pills-compact": "" } : {})}
        className="flex min-w-0 items-center gap-1"
      >
        {data.parentSessionId !== undefined && (
          <Link
            to="/session/$id"
            params={{ id: data.parentSessionId }}
            className={`${PILL_CLASS} cursor-pointer`}
          >
            <ArrowLeft aria-hidden className="size-3 shrink-0" />
            Parent session
          </Link>
        )}
        <div className="flex min-w-[32px] items-center">
          <SessionTitleButton rename={rename} className={TITLE_CLASS} summary={summary} />
          <Menu onOpenChangeComplete={menuRename.onOpenChangeComplete}>
            <Tooltip content="More options" side="bottom">
              <MenuTrigger
                aria-label={`More options for ${rename.title}`}
                className={CHEVRON_CLASS}
              >
                <ChevronDown aria-hidden className="size-4" />
              </MenuTrigger>
            </Tooltip>
            <MenuContent finalFocus={menuRename.finalFocus}>
              <HeaderMenuBody
                sessionId={sessionId}
                data={data}
                title={rename.title}
                isActive={isActive}
                requestRename={menuRename.requestRename}
                local={local}
              />
            </MenuContent>
          </Menu>
        </div>
        {data.archived && <ArchivedBadge />}
        <span
          data-origin-pills=""
          className={`flex items-center gap-[3px] ${compact ? "shrink-0" : "min-w-0"}`}
        >
          <ProjectPill sessionId={sessionId} data={data} compact={compact} />
          {modelLabel !== null && (
            <OriginPill kind="model" icon={Cpu} label={modelLabel} compact={compact} />
          )}
          {data.entrypoint !== undefined && data.entrypoint !== "cli" && (
            <OriginPill
              kind="entrypoint"
              icon={AppWindow}
              label={data.entrypoint}
              compact={compact}
            />
          )}
          {data.sessionKind !== undefined && (
            <OriginPill kind="kind" icon={Tag} label={data.sessionKind} compact={compact} />
          )}
          {data.attributionAgent !== undefined && (
            <OriginPill
              kind="agent"
              icon={Bot}
              label={data.attributionAgent}
              title="Transcript attribution agent"
              compact={compact}
            />
          )}
          {data.teamNames?.map((team) => (
            <OriginPill key={team} kind="team" icon={Users} label={team} compact={compact} />
          ))}
          {data.forkedFromSessionId !== undefined && (
            <Link
              to="/session/$id"
              params={{ id: data.forkedFromSessionId }}
              data-origin-pill="forked-from"
              title={`Forked from ${data.forkedFromSessionId}`}
              className={`${PILL_CLASS} cursor-pointer`}
            >
              <PillContent
                icon={GitFork}
                label={`Forked from ${data.forkedFromSessionId.slice(0, 8)}`}
                compact={compact}
              />
            </Link>
          )}
          {subagents !== undefined && (
            <SubagentsPill
              sessionId={sessionId}
              total={subagents.total}
              running={subagents.running}
              compact={compact}
            />
          )}
          {isActive && (
            <span
              data-origin-pill="active"
              title="Active"
              className="inline-flex h-5 shrink-0 items-center gap-1 rounded-r3 bg-success-900 px-[5px] text-caption text-success-000"
            >
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-success-000" />
              <span data-origin-label="" className={compact ? "sr-only" : undefined}>
                Active
              </span>
            </span>
          )}
        </span>
      </div>
      <div
        data-titlebar-trail=""
        className="relative ml-auto flex shrink-0 items-center gap-1 pl-6 text-secondary"
      >
        <TitlebarWidthContext.Provider value={width}>
          {paneToggles !== undefined && (
            <div className="flex items-center gap-1">{paneToggles}</div>
          )}
          {viewOptions}
        </TitlebarWidthContext.Provider>
      </div>
    </div>
  );
}
