import { createFileRoute } from "@tanstack/react-router";
import { TaskListResponse } from "../../lib/api/tasks";

export const Route = createFileRoute("/api/tasks")({
  server: {
    handlers: {
      GET: async () => {
        const { getDb } = await import("../../lib/db");
        const { getIncompleteTasksGroupedByProject } = await import("../../lib/db/queries");

        const { index } = getDb();
        const groups = getIncompleteTasksGroupedByProject(index);

        return Response.json(TaskListResponse.parse(groups), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
