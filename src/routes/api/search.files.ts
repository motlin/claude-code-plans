import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { FileSearchResponse, type FileSearchResult } from "../../lib/api/search";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

interface FileSearchDependencies {
  resolveScope(scopeRoot: string): Promise<string | null>;
  search(query: string, scopeRoot: string): FileSearchResult;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": PRIVATE_NO_CACHE },
  });
}

export async function handleFileSearchRequest(
  request: Request,
  dependencies: FileSearchDependencies,
): Promise<Response> {
  const parameters = new URL(request.url).searchParams;
  const query = parameters.get("query")?.trim() ?? "";
  const scopeRoot = parameters.get("scopeRoot")?.trim() ?? "";
  if (!query || !scopeRoot) {
    return jsonResponse({ error: "query and scopeRoot are required" }, 400);
  }

  const resolvedScope = await dependencies.resolveScope(scopeRoot);
  if (resolvedScope === null) {
    return jsonResponse({ error: "scopeRoot is not an allowed directory" }, 403);
  }

  return jsonResponse(FileSearchResponse.parse(dependencies.search(query, resolvedScope)));
}

export const Route = createFileRoute("/api/search/files")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ request }: { request: Request }) => {
        const { getDb } = await import("../../lib/db");
        const { searchFileContentDb } = await import("../../lib/db/queries");
        const { resolveFileSearchRoots, resolveFileSearchScope } = await import("../../lib/config");
        const { index } = getDb();
        const roots = await resolveFileSearchRoots(index);

        return handleFileSearchRequest(request, {
          resolveScope: (scopeRoot) => resolveFileSearchScope(scopeRoot, undefined, roots),
          search: (query, scopeRoot) => searchFileContentDb(index, query, scopeRoot),
        });
      },
    }),
  },
});
