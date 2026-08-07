import { createFileRoute } from "@tanstack/react-router";

export function handleUnknownApiRequest(): Response {
  return Response.json({ error: "API endpoint not found" }, { status: 404 });
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: handleUnknownApiRequest,
    },
  },
});
