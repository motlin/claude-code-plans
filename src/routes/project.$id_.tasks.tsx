import { Suspense, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle, Circle, Ban } from "lucide-react";
import { projectDetailQueryOptions, projectTasksQueryOptions } from "../lib/api/projects";
import { DetailTopBar, pillStyles } from "../components/detail-top-bar";
import { DebugLink } from "../components/debug-link";
import { MarkdownInline, MarkdownView } from "../components/markdown-view";
import { TaskMetadata } from "../components/task-metadata";
import { TaskOwner } from "../components/task-owner";
import { filterTasks } from "../lib/task-search";

export const Route = createFileRoute("/project/$id_/tasks")({
  component: ProjectTasksPage,
  loader: async ({ context: { queryClient }, params }) => {
    const [detail] = await Promise.all([
      queryClient.ensureQueryData(projectDetailQueryOptions(params.id)),
      queryClient.ensureQueryData(projectTasksQueryOptions(params.id)),
    ]);
    return detail;
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.name} tasks` : "Project Not Found" }],
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

function ProjectTasksPage() {
  const { id } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectDetailQueryOptions(id));
  const { data: tasksData } = useSuspenseQuery(projectTasksQueryOptions(id));
  const [searchQuery, setSearchQuery] = useState("");
  const { todos, todoCounts } = tasksData;
  const visibleTodos = useMemo(() => filterTasks(todos, searchQuery), [todos, searchQuery]);

  if (!project) {
    return (
      <div>
        <DetailTopBar>
          <Link to="/projects" className={pillStyles.primary}>
            <ArrowLeft className="h-3.5 w-3.5" />
            All Projects
          </Link>
        </DetailTopBar>
        <h1 className="mt-4 text-lg font-semibold">Project Not Found</h1>
      </div>
    );
  }

  return (
    <div>
      <DetailTopBar>
        <Link to="/project/$id" params={{ id: project.id }} className={pillStyles.primary}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {project.name}
        </Link>
      </DetailTopBar>

      <h1 className="text-lg font-semibold">{project.name} tasks</h1>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-text-500">
        <span>{todoCounts.total} total</span>
        {todoCounts.pending > 0 && <span>{todoCounts.pending} pending</span>}
        {todoCounts.inProgress > 0 && (
          <span className="text-blue-500">{todoCounts.inProgress} in progress</span>
        )}
        {todoCounts.completed > 0 && (
          <span className="text-green-500">{todoCounts.completed} completed</span>
        )}
      </p>

      <input
        type="search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search tasks by title, description, active form, or owner..."
        aria-label="Search tasks"
        className="mt-4 w-full rounded-md border border-border-300/15 bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent-100"
      />

      {todos.length === 0 ? (
        <p className="mt-4 text-text-500">No tasks for this project.</p>
      ) : visibleTodos.length === 0 ? (
        <p className="mt-4 text-text-500">No tasks match &ldquo;{searchQuery.trim()}&rdquo;.</p>
      ) : (
        <div className="mt-4 space-y-1">
          {visibleTodos.map((task) => (
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
                  <DebugLink kind="task" relativePath={`${task.projectDir}/${task.taskId}.json`} />
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
}
