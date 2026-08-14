import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  herdrWorkspacesQueryOptions,
  type HerdrWorkspaceData,
  type HerdrWorkspacePaneData,
} from "../lib/api/herdr-workspaces";
import { splitTerminalTitleGlyph } from "../lib/herdr/terminal-title";
import { HerdrStatusIndicator } from "./herdr-status-indicator";
import { LoadingBars } from "./sidebar/primitives/LoadingBars";

/**
 * Fixed columns shared by workspace headers and pane rows so the disclosure
 * chevrons, titles, and status words line up down the whole rail regardless of
 * how deeply a row is nested.
 */
const RAIL_ROW = "grid grid-cols-[1rem_minmax(0,1fr)_4.5rem] items-center gap-1.5 py-1 text-xs";

function PaneTitle({ title }: { title: string }) {
  const { glyph, title: rest } = splitTerminalTitleGlyph(title);
  return (
    <span className="truncate">
      {glyph === null ? null : (
        <span aria-hidden="true" className="mr-1 text-t6">
          {glyph}
        </span>
      )}
      {rest}
    </span>
  );
}

function PaneRow({
  pane,
  workspaceLabel,
  selected,
}: {
  pane: HerdrWorkspacePaneData;
  workspaceLabel: string;
  selected: boolean;
}) {
  const body = (
    <>
      <span />
      <PaneTitle title={pane.title} />
      <HerdrStatusIndicator status={pane.agentStatus} />
    </>
  );

  /**
   * Only Claude panes ccp has indexed can open a detail view — the live
   * terminal route resolves a herdr pane through the session transcript id, so
   * Codex panes and unindexed Claude panes have nothing to navigate to.
   */
  if (pane.sessionId === null) {
    return (
      <div
        className={`${RAIL_ROW} pl-4 text-t6`}
        title={`${pane.title} has no indexed Claude transcript to open`}
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      to="/herdr/terminal/$sessionId"
      params={{ sessionId: pane.sessionId }}
      aria-label={`Open live terminal for ${pane.title} in workspace ${workspaceLabel}`}
      {...(selected ? { "aria-current": "page" as const } : {})}
      className={`${RAIL_ROW} rounded-r3 pl-4 pr-1 no-underline transition-colors ${
        selected
          ? "bg-fill-ghost-hover font-medium text-primary"
          : "text-secondary hover:bg-fill-ghost-hover hover:text-primary"
      }`}
    >
      {body}
    </Link>
  );
}

function WorkspaceGroup({
  workspace,
  selectedSessionId,
}: {
  workspace: HerdrWorkspaceData;
  selectedSessionId: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const [shellsShown, setShellsShown] = useState(false);
  const shellCount = workspace.shellPanes.length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} workspace ${workspace.number} ${workspace.label}`}
        title={
          workspace.worktreeName === null
            ? undefined
            : `Linked worktree of ${workspace.worktreeName}`
        }
        className={`${RAIL_ROW} w-full rounded-r3 px-1 text-left text-primary transition-colors hover:bg-fill-ghost-hover`}
      >
        <ChevronRight
          aria-hidden="true"
          className="h-3 w-3 justify-self-center transition-transform duration-200"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
        <span className="truncate font-medium">
          <span className="mr-1.5 tabular-nums font-normal text-t6">{workspace.number}</span>
          {workspace.label}
        </span>
        <HerdrStatusIndicator status={workspace.agentStatus} />
      </button>

      {expanded && (
        <>
          {workspace.agentPanes.map((pane) => (
            <PaneRow
              key={pane.paneId}
              pane={pane}
              workspaceLabel={workspace.label}
              selected={pane.sessionId === selectedSessionId}
            />
          ))}
          {shellCount > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShellsShown((current) => !current)}
                aria-expanded={shellsShown}
                aria-label={`${shellsShown ? "Hide" : "Show"} ${shellCount} shell pane${
                  shellCount === 1 ? "" : "s"
                } in ${workspace.label}`}
                className="ml-4 rounded-r3 px-1 py-0.5 text-[10px] text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-secondary"
              >
                {shellCount} shell{shellCount === 1 ? "" : "s"}
              </button>
              {shellsShown &&
                workspace.shellPanes.map((pane) => (
                  <PaneRow
                    key={pane.paneId}
                    pane={pane}
                    workspaceLabel={workspace.label}
                    selected={false}
                  />
                ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Persistent workspace picker for the Herdr master-detail layout. It survives
 * navigation into a pane's detail view so switching panes never requires going
 * back to the index list.
 */
export function HerdrWorkspaceRail({ selectedSessionId }: { selectedSessionId: string | null }) {
  const { data } = useQuery(herdrWorkspacesQueryOptions);

  return (
    <nav
      aria-label="Herdr workspaces"
      className="sticky top-0 hidden h-[calc(100dvh-4rem)] w-72 shrink-0 self-start overflow-y-auto border-r border-border px-2 py-1 md:block"
    >
      {data === undefined ? (
        <LoadingBars />
      ) : data.workspaces.length === 0 ? (
        <p className="px-1 py-2 text-xs italic text-t6">No Herdr workspaces</p>
      ) : (
        data.workspaces.map((workspace) => (
          <WorkspaceGroup
            key={workspace.workspaceId}
            workspace={workspace}
            selectedSessionId={selectedSessionId}
          />
        ))
      )}
    </nav>
  );
}
