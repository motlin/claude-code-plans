import { createFileRoute } from "@tanstack/react-router";
import { CustomizeFileResponse } from "../../lib/api/customize";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": PRIVATE_NO_CACHE } });
}

/**
 * One file inside a listed skill's directory: `?skill=<id>&path=<relative>`.
 * The path is resolved by `readFileUnderRoot`, which refuses `..`, absolute
 * paths and symlinks that land outside the skill directory.
 */
export const Route = createFileRoute("/api/customize/file")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const skillId = url.searchParams.get("skill");
        const path = url.searchParams.get("path");
        if (skillId === null || path === null) {
          return errorResponse("skill and path query parameters are required", 400);
        }

        const { findIndexedSkill } = await import("../../lib/customize/indexed-skills");
        const skill = await findIndexedSkill(skillId);
        if (skill === undefined) return errorResponse("Skill not found", 404);

        const { FileServingError, readFileUnderRoot } = await import("../../lib/file-serving");
        try {
          const file = await readFileUnderRoot(skill.dir, path);
          return Response.json(CustomizeFileResponse.parse({ path, content: file.content }), {
            headers: { "Cache-Control": PRIVATE_NO_CACHE },
          });
        } catch (error) {
          if (error instanceof FileServingError) return errorResponse(error.message, error.status);
          throw error;
        }
      },
    }),
  },
});
