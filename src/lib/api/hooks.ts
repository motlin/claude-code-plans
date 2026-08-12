import { z } from "zod";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { PersistedCapabilities } from "../capabilities";

/**
 * Install state of the ccp hook block in ~/.claude/settings.json.
 * `missingEvents` names the events that are absent, so a page fed by one
 * specific event can explain its own emptiness without re-reading settings.
 */
export const HookStatusResponse = z.object({
  installed: z.boolean(),
  partial: z.boolean(),
  installedCount: z.number(),
  totalCount: z.number(),
  missingEvents: z.array(z.string()),
  settingsPath: z.string(),
});

export const hookStatusQueryOptions = queryOptions({
  queryKey: ["hooks", "status"] as const,
  queryFn: () => apiFetch("/api/hooks/status", HookStatusResponse),
  staleTime: Infinity,
  gcTime: Infinity,
});

export const HookMutationResponse = z.object({
  ok: z.boolean(),
  settingsPath: z.string(),
});

export const useInstallHooks = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ port, capabilities }: { port?: number; capabilities: PersistedCapabilities }) =>
      apiFetch("/api/hooks", HookMutationResponse, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(port !== undefined ? { port, capabilities } : { capabilities }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["hooks", "status"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
};

export const useUninstallHooks = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ port }: { port?: number }) =>
      apiFetch("/api/hooks", HookMutationResponse, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(port !== undefined ? { port } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["hooks", "status"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
};
