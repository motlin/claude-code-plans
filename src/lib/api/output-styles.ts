import {queryOptions} from "@tanstack/react-query";
import {OutputStylesSchema} from "../output-style-options";
import {apiFetch} from "./client";

export const outputStylesQueryOptions = queryOptions(
	{
		queryKey: ["output-styles"] as const,
		queryFn: async () => apiFetch("/api/output-styles", OutputStylesSchema),
		staleTime: 0,
	},
);

/** The styles a session in `cwd` can pick: the user's, the project's `.claude/output-styles/` and plugin styles. */
export const sessionOutputStylesQueryOptions = (cwd: string) =>
	queryOptions(
		{
			queryKey: ["output-styles", cwd] as const,
			queryFn: async () => apiFetch(`/api/output-styles?cwd=${encodeURIComponent(cwd)}`, OutputStylesSchema),
			staleTime: 0,
		},
	);
