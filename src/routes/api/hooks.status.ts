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
        const { generateHooksConfig, HOOK_EVENT_NAMES } = await import("../../lib/hook-config");
        const settingsPath = join(homedir(), ".claude", "settings.json");

        let existing: Record<string, unknown> = {};
        try {
          const raw = await readFile(settingsPath, "utf-8");
          existing = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return Response.json(
            HookStatusResponse.parse({
              installed: false,
              partial: false,
              settingsPath,
            }),
            {
              headers: {
                "Cache-Control": "private, max-age=0, must-revalidate",
              },
            },
          );
        }

        const hooks = existing["hooks"] as Record<string, unknown[]> | undefined;
        if (!hooks) {
          return Response.json(
            HookStatusResponse.parse({
              installed: false,
              partial: false,
              settingsPath,
            }),
            {
              headers: {
                "Cache-Control": "private, max-age=0, must-revalidate",
              },
            },
          );
        }

        const desired = generateHooksConfig();
        const installedCount = HOOK_EVENT_NAMES.filter((name) => {
          const entries = hooks[name];
          if (!Array.isArray(entries)) return false;
          const desiredCmd = (desired.hooks[name]?.[0]?.hooks[0] as { command: string } | undefined)
            ?.command;
          return entries.some((e) => {
            const entryHooks = (e as { hooks?: Array<{ command?: string }> }).hooks;
            return entryHooks?.some((h) => h.command === desiredCmd);
          });
        }).length;

        return Response.json(
          HookStatusResponse.parse({
            installed: installedCount === HOOK_EVENT_NAMES.length,
            partial: installedCount > 0 && installedCount < HOOK_EVENT_NAMES.length,
            installedCount,
            totalCount: HOOK_EVENT_NAMES.length,
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
