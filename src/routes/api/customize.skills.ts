import { createFileRoute } from "@tanstack/react-router";
import { SkillListResponse } from "../../lib/api/customize";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/customize/skills")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const { listIndexedSkills } = await import("../../lib/customize/indexed-skills");
        const skills = await listIndexedSkills();
        return Response.json(SkillListResponse.parse(skills), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
