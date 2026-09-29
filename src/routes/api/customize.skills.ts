import { createFileRoute } from "@tanstack/react-router";
import { SkillListResponse } from "../../lib/api/customize";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/customize/skills")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const { getDb } = await import("../../lib/db");
        const { listProjectsFromDb } = await import("../../lib/db/queries");
        const { listSkills } = await import("../../lib/customize/skills");
        const projects = listProjectsFromDb(getDb().index).flatMap(({ id, projectPath }) =>
          projectPath === null ? [] : [{ id, projectPath }],
        );
        const skills = await listSkills({ projects });
        return Response.json(SkillListResponse.parse(skills), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
