import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { z } from "zod";
import { type NavSection, toggleNavSection, VisibleNavSectionsSchema } from "../nav-sections";
import { apiFetch } from "./client";

const ApplicationSettingsResponse = z
  .object({
    herdrWritesEnabled: z.boolean(),
    visibleNavSections: VisibleNavSectionsSchema,
    ignoredDirs: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const applicationSettingsQueryOptions = queryOptions({
  queryKey: ["application-settings"] as const,
  queryFn: () => apiFetch("/api/application-settings", ApplicationSettingsResponse),
  staleTime: 0,
});

type ApplicationSettingsData = z.infer<typeof ApplicationSettingsResponse>;

export function useSaveApplicationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: z.infer<typeof ApplicationSettingsResponse>) =>
      apiFetch("/api/application-settings", ApplicationSettingsResponse, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(applicationSettingsQueryOptions.queryKey, settings);
      void queryClient.invalidateQueries({ queryKey: ["herdr"] });
      void queryClient.invalidateQueries({ queryKey: ["terminal-placements"] });
    },
  });
}

/**
 * Pin or unpin one sidebar section. The cache updates optimistically so the sidebar and the Edit
 * sidebar dialog react at once; saves run serially so the server sees toggles in click order.
 */
export function useSetNavSectionPinned() {
  const queryClient = useQueryClient();
  const { mutate } = useMutation({
    scope: { id: "application-settings" },
    mutationFn: (settings: ApplicationSettingsData) =>
      apiFetch("/api/application-settings", ApplicationSettingsResponse, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      }),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: applicationSettingsQueryOptions.queryKey });
    },
  });

  return useCallback(
    (section: NavSection, pinned: boolean) => {
      const current = queryClient.getQueryData(applicationSettingsQueryOptions.queryKey);
      if (current === undefined) return;
      const next = {
        ...current,
        visibleNavSections: toggleNavSection(current.visibleNavSections, section, pinned),
      };
      queryClient.setQueryData(applicationSettingsQueryOptions.queryKey, next);
      mutate(next);
    },
    [queryClient, mutate],
  );
}
