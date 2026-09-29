import { FolderGit2, GitBranch, GitPullRequest, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SessionDetailData } from "../lib/api/sessions";
import { pluralize } from "../lib/pluralize";
import { type GitPrState, prGlyph } from "../lib/pr-status";
import { useOptionalPaneHost } from "./panes/tile-host";
import { ProjectMenuItems } from "./session-titlebar";
import { Menu, MenuContent, MenuTrigger } from "./ui/menu";

/** Upstream hides the strip in a tile this narrow or narrower. */
const HIDDEN_AT_OR_BELOW_PX = 320;

/** Longest branch label before the middle is elided; the full name stays in the tooltip. */
const BRANCH_MAX_CHARS = 32;

const DISMISS_KEY_PREFIX = "branch-strip-dismissed:";

const GHOST_BUTTON =
  "inline-flex h-6 min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-r5 px-1.5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 data-[popup-open]:bg-fill-ghost-hover";

const PR_STATE_CLASS = {
  opened: "text-git-opened",
  draft: "text-git-draft",
  merged: "text-git-merged",
  closed: "text-git-closed",
  conflicting: "text-git-conflicting",
  queued: "text-git-queued",
} as const satisfies Record<GitPrState, string>;

/** The session fields the strip reads. */
export type BranchStripSession = Pick<
  SessionDetailData,
  "projectName" | "projectPath" | "cwd" | "gitBranch" | "pr" | "prStatus"
>;

/** `feature/abc…xyz`: keeps the start and end of a name longer than `max` characters. */
export function middleTruncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const kept = max - 1;
  const head = Math.ceil(kept / 2);
  const tail = kept - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

function numberAt(data: Record<string, unknown> | null, group: string, key: string) {
  const value = data?.[group];
  if (value === null || typeof value !== "object") return undefined;
  const leaf = (value as Record<string, unknown>)[key];
  return typeof leaf === "number" ? leaf : undefined;
}

/** `+N −M` from the statusline's `cost.total_lines_added/removed`, or null when nothing changed. */
function lineCounts(statusline: Record<string, unknown> | null) {
  const additions = numberAt(statusline, "cost", "total_lines_added") ?? 0;
  const deletions = numberAt(statusline, "cost", "total_lines_removed") ?? 0;
  return additions > 0 || deletions > 0 ? { additions, deletions } : null;
}

function readDismissed(sessionId: string): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY_PREFIX + sessionId) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(sessionId: string): void {
  try {
    sessionStorage.setItem(DISMISS_KEY_PREFIX + sessionId, "1");
  } catch {
    // Storage is unavailable; the dismissal lasts until the page reloads.
  }
}

/** Dismissal is per session and per tab, like upstream. */
function useDismissed(sessionId: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(readDismissed(sessionId)), [sessionId]);
  const dismiss = useCallback(() => {
    writeDismissed(sessionId);
    setDismissed(true);
  }, [sessionId]);
  return [dismissed, dismiss];
}

function useContainerWidth() {
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
  return { ref, width };
}

function DiffStatButton({ additions, deletions }: { additions: number; deletions: number }) {
  const host = useOptionalPaneHost();
  const added = additions.toLocaleString("en-US");
  const removed = deletions.toLocaleString("en-US");
  return (
    <button
      type="button"
      title="Show changes"
      className={`${GHOST_BUTTON} tabular-nums`}
      onClick={() => host?.openPane("changes")}
    >
      <span aria-hidden="true">
        <span className="text-diff-added">+{added}</span>{" "}
        <span className="text-diff-removed">−{removed}</span>
      </span>
      <span className="sr-only">
        {`${added} ${pluralize(additions, "addition")}, ${removed} ${pluralize(deletions, "deletion")}`}
      </span>
    </button>
  );
}

function PrChip({ session }: { session: BranchStripSession }) {
  const number = session.prStatus?.number ?? session.pr?.number;
  if (number === undefined) return null;
  const url = session.prStatus?.url ?? session.pr?.url;
  const state = session.prStatus === undefined ? undefined : prGlyph(session.prStatus).state;
  const color = state === undefined ? "text-secondary" : PR_STATE_CLASS[state];
  const title = session.prStatus?.title ?? `Pull request #${number}`;
  const content = (
    <>
      <GitPullRequest aria-hidden className={`size-3.5 shrink-0 ${color}`} />
      {`#${number}`}
    </>
  );
  const common = {
    "data-pr-chip": "",
    ...(state === undefined ? {} : { "data-pr-state": state }),
    title,
    className: `${GHOST_BUTTON} tabular-nums no-underline`,
  };
  return url === undefined ? (
    <span {...common}>{content}</span>
  ) : (
    <a {...common} href={url} target="_blank" rel="noopener noreferrer">
      {content}
    </a>
  );
}

/**
 * Upstream's composer branch strip: project menu · branch · `+N −M` (opens Changes) · PR chip ·
 * Dismiss. Built from local data: the indexed branch and pr-link, the PR status service, and the
 * statusline's line counts. Create PR is cloud-only and has no local counterpart.
 */
export function BranchStrip({
  sessionId,
  session,
  statusline,
}: {
  sessionId: string;
  session: BranchStripSession;
  statusline: Record<string, unknown> | null;
}) {
  const [dismissed, dismiss] = useDismissed(sessionId);
  const { ref, width } = useContainerWidth();
  const counts = lineCounts(statusline);
  const branch = session.gitBranch;
  const hasPr = session.pr !== undefined || session.prStatus !== undefined;

  if (dismissed || (branch === null && counts === null && !hasPr)) return null;
  const narrow = width !== null && width <= HIDDEN_AT_OR_BELOW_PX;
  const path = session.projectPath ?? session.cwd;

  return (
    <div ref={ref}>
      {!narrow && (
        <div
          data-branch-strip=""
          className="mb-2 flex min-h-10 min-w-0 items-center gap-1 rounded-r7 bg-alpha-1 p-2 text-[13px]"
        >
          <Menu>
            <MenuTrigger title={path ?? session.projectName} className={GHOST_BUTTON}>
              <FolderGit2 aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{session.projectName}</span>
            </MenuTrigger>
            <MenuContent>
              <ProjectMenuItems sessionId={sessionId} session={session} />
            </MenuContent>
          </Menu>
          {branch !== null && (
            <span
              data-branch-name=""
              title={branch}
              className="inline-flex min-w-0 items-center gap-1 px-1.5 font-mono text-secondary"
            >
              <GitBranch aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{middleTruncate(branch, BRANCH_MAX_CHARS)}</span>
            </span>
          )}
          {counts !== null && <DiffStatButton {...counts} />}
          <PrChip session={session} />
          <button
            type="button"
            aria-label="Dismiss"
            title="Dismiss"
            className={`${GHOST_BUTTON} ml-auto`}
            onClick={dismiss}
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
