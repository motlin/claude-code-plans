import {queryOptions} from "@tanstack/react-query";
import {UsageSummaryResponse} from "../usage";
import {apiFetch} from "./client";

export const usageQueryOptions = queryOptions({
	queryKey: ["usage"] as const,
	queryFn: () => apiFetch("/api/usage", UsageSummaryResponse),
});
