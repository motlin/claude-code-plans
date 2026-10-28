import {queryOptions} from "@tanstack/react-query";
import {UsageSummaryResponse} from "../usage";
import {apiFetch} from "./client";

export const usageQueryOptions = queryOptions({
	queryKey: ["usage"] as const,
	queryFn: async () => apiFetch("/api/usage", UsageSummaryResponse),
	// Upstream's usage hook: every 5 minutes, and always on mount and window focus.
	refetchInterval: 300_000,
	refetchOnMount: "always",
	refetchOnWindowFocus: "always",
});
