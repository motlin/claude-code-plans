import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useMemo, useState } from "react";
import { ChevronRight, CheckCircle, Circle, Ban, List, GitBranch } from "lucide-react";
import { tasksQueryOptions } from "../lib/api/tasks";
import { TaskDependencyGraph } from "../components/task-dependency-graph";
import { DebugLink } from "../components/debug-link";
import { MarkdownInline, MarkdownView } from "../components/markdown-view";
import { TaskMetadata } from "../components/task-metadata";
import { TaskOwner } from "../components/task-owner";
import { filterTasks } from "../lib/task-search";

export const Route = createFileRoute("/tasks")({
  component: TasksPage,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(tasksQueryOptions),
  head: () => ({
    meta: [{ title: "Tasks" }],
  }),
});

const statusBadgeClasses: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  in_progress: "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
  completed: "bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400",
};

const statusLabel: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
};

type View = "list" | "graph";

function TasksPage() {
  const { data: groups } = useSuspenseQuery(tasksQueryOptions);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => {
          const tasks = filterTasks(group.tasks, searchQuery);
          return {
            ...group,
            tasks,
            totalPending: tasks.filter((task) => task.status === "pending").length,
            totalInProgress: tasks.filter((task) => task.status === "in_progress").length,
          };
        })
        .filter((group) => group.tasks.length > 0),
    [groups, searchQuery],
  );

  function toggleGroup(projectDir: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectDir)) {
        next.delete(projectDir);
      } else {
        next.add(projectDir);
      }
      return next;
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Tasks</h1>
        <div className="flex items-center gap-1 rounded-md border border-border-300/30 p-0.5">
          <button
            type="button"
            onClick={() => setView("list")}
            className={`rounded px-2 py-1 text-xs transition-colors ${view === "list" ? "bg-bg-200 text-text-100" : "text-text-500 hover:text-text-300"}`}
            title="List view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setView("graph")}
            className={`rounded px-2 py-1 text-xs transition-colors ${view === "graph" ? "bg-bg-200 text-text-100" : "text-text-500 hover:text-text-300"}`}
            title="Dependency graph"
          >
            <GitBranch className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <input
        type="search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search tasks by title, description, active form, or owner..."
        aria-label="Search tasks"
        className="mt-4 w-full rounded-md border border-border-300/15 bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent-100"
      />

      {groups.length === 0 ? (
        <p className="mt-4 text-text-500">No incomplete tasks across any projects.</p>
      ) : visibleGroups.length === 0 ? (
        <p className="mt-4 text-text-500">No tasks match &ldquo;{searchQuery.trim()}&rdquo;.</p>
      ) : view === "graph" ? (
        <TaskDependencyGraph groups={visibleGroups} />
      ) : (
        <div className="mt-6 space-y-4">
          {visibleGroups.map((group) => {
            const isCollapsed = collapsed.has(group.projectDir);
            return (
              <div key={group.projectDir}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.projectDir)}
                  className="flex w-full items-center gap-2 border-b border-border-300/15 pb-1 cursor-pointer"
                >
                  <ChevronRight
                    className="h-3 w-3 text-text-500 transition-transform duration-200"
                    style={{
                      transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                    }}
                  />
                  <span className="text-sm font-semibold">{group.projectDir}</span>
                  <span className="flex items-center gap-2 text-xs text-text-500">
                    {group.totalPending > 0 && (
                      <span className="flex items-center gap-1">
                        <Circle className="h-3 w-3" /> {group.totalPending} pending
                      </span>
                    )}
                    {group.totalInProgress > 0 && (
                      <span className="flex items-center gap-1 text-blue-500">
                        <Circle className="h-3 w-3" /> {group.totalInProgress} in progress
                      </span>
                    )}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="mt-2 space-y-1">
                    {group.tasks.map((task) => (
                      <div key={task.taskId} className="flex items-start gap-2 rounded-md p-2">
                        {task.status === "completed" ? (
                          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                        ) : (
                          <Circle
                            className={`mt-0.5 h-4 w-4 shrink-0 ${task.status === "in_progress" ? "text-blue-500" : "text-text-500"}`}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-text-100 flex items-center gap-1.5">
                            <span>
                              #{task.taskId}{" "}
                              <Suspense fallback={null}>
                                <MarkdownInline markdown={task.subject} />
                              </Suspense>
                            </span>
                            <DebugLink
                              kind="task"
                              relativePath={`${group.projectDir}/${task.taskId}.json`}
                            />
                          </div>
                          {task.description && task.description !== task.subject && (
                            <div className="mt-0.5 text-xs text-text-500">
                              <Suspense fallback={null}>
                                <MarkdownView markdown={task.description} />
                              </Suspense>
                            </div>
                          )}
                          <div className="mt-0.5 flex items-center gap-2">
                            <span
                              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClasses[task.status] ?? ""}`}
                            >
                              {statusLabel[task.status] ?? task.status}
                            </span>
                            {task.blockedBy.length > 0 && (
                              <span className="flex items-center gap-1 text-[10px] text-orange-500">
                                <Ban className="h-3 w-3" />
                                blocked by #{task.blockedBy.join(", #")}
                              </span>
                            )}
                            <TaskOwner owner={task.owner} />
                          </div>
                          <TaskMetadata metadata={task.metadata} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
