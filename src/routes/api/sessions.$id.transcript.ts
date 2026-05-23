import { createFileRoute } from "@tanstack/react-router";
import { TranscriptResponse } from "../../lib/api/sessions";

export const Route = createFileRoute("/api/sessions/$id/transcript")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        const { getDb } = await import("../../lib/db");
        const { getSubagentById } = await import("../../lib/db/queries");
        const { sessions } = await import("../../lib/db/schema");
        const { eq } = await import("drizzle-orm");
        const { readFileSync, statSync } = await import("node:fs");

        const { id } = params;
        const { index } = getDb();
        const row = index.select().from(sessions).where(eq(sessions.id, id)).get();

        let filePath: string | undefined;
        if (row) {
          filePath = row.filePath;
        } else {
          const subagent = getSubagentById(index, id);
          if (subagent) filePath = subagent.filePath;
        }

        if (!filePath) {
          return Response.json(TranscriptResponse.parse({ records: [], byteOffset: 0 }), {
            headers: {
              "Cache-Control": "private, max-age=0, must-revalidate",
            },
          });
        }

        try {
          const fileSize = statSync(filePath).size;
          const content = readFileSync(filePath, "utf-8");
          const records = content
            .split("\n")
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line) as Record<string, unknown>);
          return Response.json(TranscriptResponse.parse({ records, byteOffset: fileSize }), {
            headers: {
              "Cache-Control": "private, max-age=0, must-revalidate",
            },
          });
        } catch {
          return Response.json(TranscriptResponse.parse({ records: [], byteOffset: 0 }), {
            headers: {
              "Cache-Control": "private, max-age=0, must-revalidate",
            },
          });
        }
      },
    },
  },
});
