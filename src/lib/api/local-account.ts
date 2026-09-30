import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";

const LocalAccountResponse = z
	.object({
		name: z.string(),
		firstName: z.string(),
		initial: z.string(),
		email: z.string().optional(),
		planLabel: z.string().optional(),
		planDetail: z.string().optional(),
	})
	.strict();

export const localAccountQueryOptions = queryOptions({
	queryKey: ["local-account"] as const,
	queryFn: () => apiFetch("/api/local-account", LocalAccountResponse),
	staleTime: Infinity,
});
