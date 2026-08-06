import { createFileRoute } from "@tanstack/react-router";
import { decodeFilePath, FileViewerErrorResponse, FileViewerResponse } from "../../lib/api/file";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

function errorResponse(error: string, status: number): Response {
  return Response.json(FileViewerErrorResponse.parse({ error }), {
    status,
    headers: { "Cache-Control": PRIVATE_NO_CACHE },
  });
}

export async function handleFileRequest(
  request: Request,
  pathToken: string,
  configPath?: string,
): Promise<Response> {
  const requestedPath = decodeFilePath(pathToken);
  if (requestedPath === null) return errorResponse("A valid encoded file path is required", 400);

  const { FileServingError, readAllowedFile } = await import("../../lib/file-serving");
  try {
    const file = await readAllowedFile(requestedPath, configPath);
    const etag = `"${file.modifiedAtMilliseconds}-${file.sizeBytes}"`;
    const headers = {
      "Cache-Control": PRIVATE_NO_CACHE,
      ETag: etag,
    };
    if (request.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    return Response.json(FileViewerResponse.parse({ content: file.content, path: file.path }), {
      headers,
    });
  } catch (error) {
    if (error instanceof FileServingError) return errorResponse(error.message, error.status);
    throw error;
  }
}

export const Route = createFileRoute("/api/file/$")({
  server: {
    handlers: {
      GET: async ({ params, request }: { params: { _splat?: string }; request: Request }) =>
        handleFileRequest(request, params._splat ?? ""),
    },
  },
});
