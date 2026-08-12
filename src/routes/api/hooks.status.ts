import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { HookStatusResponse } from "../../lib/api/hooks";

export const Route = createFileRoute("/api/hooks/status")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const { readFile } = await import("node:fs/promises");
        const { missingHookEvents, HOOK_EVENT_NAMES } = await import("../../lib/hook-config");
        const settingsPath = join(homedir(), ".claude", "settings.json");

        let existing: Record<string, unknown> = {};
        try {
          const raw = await readFile(settingsPath, "utf-8");
          existing = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // No readable settings file: nothing is installed.
        }

        const hooks = existing["hooks"] as Record<string, unknown> | undefined;
        const missingEvents = missingHookEvents(hooks);
        const installedCount = HOOK_EVENT_NAMES.length - missingEvents.length;

        return Response.json(
          HookStatusResponse.parse({
            installed: missingEvents.length === 0,
            partial: installedCount > 0 && missingEvents.length > 0,
            installedCount,
            totalCount: HOOK_EVENT_NAMES.length,
            missingEvents,
            settingsPath,
          }),
          {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          },
        );
      },
    }),
  },
});
