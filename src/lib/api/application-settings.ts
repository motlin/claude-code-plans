import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

const ApplicationSettingsResponse = z
  .object({
    herdrWritesEnabled: z.boolean(),
    showHerdrSection: z.boolean(),
    showTmuxSection: z.boolean(),
    watcherPolling: z.boolean(),
    ignoredDirs: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const applicationSettingsQueryOptions = queryOptions({
  queryKey: ["application-settings"] as const,
  queryFn: () => apiFetch("/api/application-settings", ApplicationSettingsResponse),
  staleTime: 0,
});

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
