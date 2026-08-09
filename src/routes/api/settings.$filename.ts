import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { z } from "zod";
import { SettingsSaveResponse } from "../../lib/api/settings";
import { rejectCrossSite } from "../../lib/same-origin-guard";

const SETTINGS_FILENAMES = ["settings.json", "settings.local.json"] as const;

export const Route = createFileRoute("/api/settings/$filename")({
  server: {
    handlers: withMethodNotAllowed({
      PUT: async ({ params, request }: { params: { filename: string }; request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const filenameParse = z.enum(SETTINGS_FILENAMES).safeParse(params.filename);
        if (!filenameParse.success) {
          return new Response("Invalid settings filename", { status: 400 });
        }
        const filename = filenameParse.data;
        const content = await request.text();

        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return new Response("Settings must be a JSON object", {
            status: 400,
          });
        }

        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const { writeFile, mkdir } = await import("node:fs/promises");
        const claudeHome = join(homedir(), ".claude");

        const pretty = JSON.stringify(parsed, null, 2) + "\n";
        const filePath = join(claudeHome, filename);

        await mkdir(claudeHome, { recursive: true });
        await writeFile(filePath, pretty, "utf-8");

        return Response.json(SettingsSaveResponse.parse({ path: filePath }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
