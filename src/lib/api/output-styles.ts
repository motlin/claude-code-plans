import {queryOptions} from "@tanstack/react-query";
import {OutputStylesSchema} from "../output-style-options";
import {apiFetch} from "./client";

export const outputStylesQueryOptions = queryOptions({
	queryKey: ["output-styles"] as const,
	queryFn: async () => apiFetch("/api/output-styles", OutputStylesSchema),
	staleTime: 0,
});
