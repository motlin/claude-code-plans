import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useId, useState } from "react";

import {
  type BackgroundTask,
  type BackgroundTaskGroups,
  backgroundTaskMeta,
} from "../../lib/background-tasks";
import { TerminalOutput } from "../tool-renderers/shared";
import { registerPane } from "./pane-registry";

const EMPTY_COPY = "No background tasks in this session.";

const SECTION_HEADING = "text-caption font-medium text-secondary";
const GHOST_BUTTON =
  "cursor-pointer rounded-r5 px-1.5 py-0.5 text-caption text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary";

function BackgroundTaskCard({ task }: { task: BackgroundTask }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  return (
    <li className="rounded-r6 border border-border bg-surface-1">
      <button
        type="button"
        data-background-task=""
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-primary">
            {task.description || task.command || task.id}
          </span>
          <span className="block text-caption text-muted">{backgroundTaskMeta(task)}</span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className={`size-4 shrink-0 text-secondary transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>
      {expanded && (
        <div id={detailsId} className="flex flex-col gap-2 border-t border-border px-3 py-2">
          {task.command !== null && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-code text-primary">
              <code>{task.command}</code>
            </pre>
          )}
          {task.output !== null ? (
            <div data-task-output="">
              <TerminalOutput content={task.output} />
            </div>
          ) : (
            <p className="text-caption text-muted">{task.summary ?? "No output recorded."}</p>
          )}
        </div>
      )}
    </li>
  );
}

function TaskCards({ tasks }: { tasks: readonly BackgroundTask[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {tasks.map((task) => (
        <BackgroundTaskCard key={task.id} task={task} />
      ))}
    </ul>
  );
}

/**
 * Upstream's Background tasks pane: "N running" then a collapsible
 * "Finished N" section whose "Clear finished" hides the rows it lists for this
 * view only (the transcript still has them).
 */
export function BackgroundTasksList({
  groups,
  subagents,
}: {
  groups: BackgroundTaskGroups;
  /** The session's subagents, linked to their tree/Gantt page. */
  subagents?: { sessionId: string; count: number };
}) {
  const [finishedOpen, setFinishedOpen] = useState(true);
  const [clearedIds, setClearedIds] = useState<ReadonlySet<string>>(new Set());
  const finished = groups.finished.filter((task) => !clearedIds.has(task.id));
  const subagentCount = subagents?.count ?? 0;

  if (groups.running.length === 0 && finished.length === 0 && subagentCount === 0) {
    return <p className="px-3 py-6 text-center text-body text-muted">{EMPTY_COPY}</p>;
  }
  return (
    <div className="flex flex-col gap-4 px-3 py-2">
      {groups.running.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className={SECTION_HEADING}>{groups.running.length} running</h3>
          <TaskCards tasks={groups.running} />
        </section>
      )}
      {finished.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className={SECTION_HEADING}>
              <button
                type="button"
                aria-expanded={finishedOpen}
                onClick={() => setFinishedOpen((open) => !open)}
                className="flex cursor-pointer items-center gap-1 hover:text-primary"
              >
                <ChevronRight
                  aria-hidden="true"
                  className={`size-3.5 transition-transform ${finishedOpen ? "rotate-90" : ""}`}
                />
                Finished {finished.length}
              </button>
            </h3>
            <button
              type="button"
              onClick={() =>
                setClearedIds(new Set([...clearedIds, ...finished.map((task) => task.id)]))
              }
              className={GHOST_BUTTON}
            >
              Clear finished
            </button>
          </div>
          {finishedOpen && <TaskCards tasks={finished} />}
        </section>
      )}
      {subagents !== undefined && subagentCount > 0 && (
        <Link
          to="/session/$id/subagents"
          params={{ id: subagents.sessionId }}
          className="self-start text-caption text-secondary underline-offset-2 hover:text-primary hover:underline"
        >
          {subagentCount} subagent{subagentCount === 1 ? "" : "s"}
        </Link>
      )}
    </div>
  );
}

/** Registers the `background-tasks` pane kind for this session while mounted. */
export function useRegisterBackgroundTasksPane(
  sessionId: string,
  groups: BackgroundTaskGroups,
  subagentCount: number,
): void {
  useEffect(
    () =>
      registerPane("background-tasks", {
        title: "Background tasks",
        render: () => (
          <BackgroundTasksList
            key={sessionId}
            groups={groups}
            subagents={{ sessionId, count: subagentCount }}
          />
        ),
      }),
    [sessionId, groups, subagentCount],
  );
}
