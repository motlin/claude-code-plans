import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { HookMutationResponse } from "../../lib/api/hooks";
import { rejectCrossSite } from "../../lib/same-origin-guard";

const HooksMutationBody = z.object({ port: z.number().optional() });

async function claudeHomeJoin() {
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  return { claudeHome: join(homedir(), ".claude"), join };
}

export const Route = createFileRoute("/api/hooks")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { claudeHome, join } = await claudeHomeJoin();
        const { generateHooksConfig } = await import("../../lib/hook-config");
        const { readFile, writeFile, mkdir } = await import("node:fs/promises");
        const body = HooksMutationBody.parse(await request.json().catch(() => ({})));
        const settingsPath = join(claudeHome, "settings.json");
        const config = generateHooksConfig(
          body.port !== undefined ? { port: body.port } : undefined,
        );

        await mkdir(claudeHome, { recursive: true });

        let existing: Record<string, unknown> = {};
        try {
          const raw = await readFile(settingsPath, "utf-8");
          existing = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // File doesn't exist or is invalid — start fresh
        }

        const existingHooks = (existing["hooks"] ?? {}) as Record<string, unknown[]>;
        for (const [eventName, matchers] of Object.entries(config.hooks)) {
          const desiredCmd = matchers[0]?.hooks[0]?.command;
          if (!desiredCmd) continue;

          const cmdPrefix = desiredCmd.slice(0, desiredCmd.indexOf("/api/hook"));
          const eventEntries = Array.isArray(existingHooks[eventName])
            ? [...existingHooks[eventName]]
            : [];

          const filtered = eventEntries.filter((e) => {
            const entryHooks = (e as { hooks?: Array<{ command?: string }> }).hooks;
            return !entryHooks?.some((h) => h.command?.includes(cmdPrefix + "/api/hook"));
          });

          filtered.push(...matchers);
          existingHooks[eventName] = filtered;
        }

        existing["hooks"] = existingHooks;

        await writeFile(settingsPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
        return Response.json(HookMutationResponse.parse({ ok: true, settingsPath }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
      DELETE: async ({ request }: { request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { claudeHome, join } = await claudeHomeJoin();
        const { generateHooksConfig } = await import("../../lib/hook-config");
        const { readFile, writeFile } = await import("node:fs/promises");
        let body: z.infer<typeof HooksMutationBody> = {};
        try {
          body = HooksMutationBody.parse(await request.json());
        } catch {
          body = {};
        }
        const settingsPath = join(claudeHome, "settings.json");
        const config = generateHooksConfig(
          body.port !== undefined ? { port: body.port } : undefined,
        );

        let existing: Record<string, unknown>;
        try {
          const raw = await readFile(settingsPath, "utf-8");
          existing = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return Response.json(HookMutationResponse.parse({ ok: true, settingsPath }), {
            headers: {
              "Cache-Control": "private, max-age=0, must-revalidate",
            },
          });
        }

        const existingHooks = (existing["hooks"] ?? {}) as Record<string, unknown[]>;
        for (const [eventName, matchers] of Object.entries(config.hooks)) {
          const desiredCmd = matchers[0]?.hooks[0]?.command;
          if (!desiredCmd) continue;

          const cmdPrefix = desiredCmd.slice(0, desiredCmd.indexOf("/api/hook"));
          const eventEntries = existingHooks[eventName];
          if (!Array.isArray(eventEntries)) continue;

          existingHooks[eventName] = eventEntries.filter((e) => {
            const entryHooks = (e as { hooks?: Array<{ command?: string }> }).hooks;
            return !entryHooks?.some((h) => h.command?.includes(cmdPrefix + "/api/hook"));
          });

          if ((existingHooks[eventName] as unknown[]).length === 0) {
            delete existingHooks[eventName];
          }
        }

        if (Object.keys(existingHooks).length === 0) {
          delete existing["hooks"];
        }

        await writeFile(settingsPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
        return Response.json(HookMutationResponse.parse({ ok: true, settingsPath }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
