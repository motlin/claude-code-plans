import {queryOptions, useMutation, useQueryClient} from "@tanstack/react-query";
import {AutoArchiveSettingSchema} from "../auto-archive-options";
import {apiFetch} from "./client";

export const autoArchiveQueryOptions = queryOptions({
	queryKey: ["auto-archive"] as const,
	queryFn: async () => apiFetch("/api/auto-archive", AutoArchiveSettingSchema),
	staleTime: 0,
});

/** Save the Archive inactive sessions window; the cache updates at once and rolls back on failure. */
export function useSaveAutoArchiveDays() {
	const queryClient = useQueryClient();
	return useMutation({
		scope: {id: "auto-archive"},
		mutationFn: async (days: number) =>
			apiFetch("/api/auto-archive", AutoArchiveSettingSchema, {
				method: "PUT",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({days}),
			}),
		onMutate: (days) => {
			const previous = queryClient.getQueryData(autoArchiveQueryOptions.queryKey);
			queryClient.setQueryData(autoArchiveQueryOptions.queryKey, {days});
			return {previous};
		},
		onError: (_error, _days, context) => {
			if (context?.previous !== undefined)
				queryClient.setQueryData(autoArchiveQueryOptions.queryKey, context.previous);
			void queryClient.invalidateQueries({queryKey: autoArchiveQueryOptions.queryKey});
		},
		onSuccess: (saved) => {
			queryClient.setQueryData(autoArchiveQueryOptions.queryKey, saved);
		},
	});
}
