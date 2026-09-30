import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";

export const HomeDismissalsResponse = z.object({dismissals: z.record(z.string(), z.number())}).strict();
export type HomeDismissals = z.infer<typeof HomeDismissalsResponse>;

export const HomeDismissBodySchema = z.object({sessionId: z.string().min(1)}).strict();

export const homeDismissalsQueryOptions = queryOptions({
	queryKey: ["home-dismissals"] as const,
	queryFn: () => apiFetch("/api/home/dismissals", HomeDismissalsResponse),
	staleTime: Infinity,
});

/** Hide a session from the home action center until it has newer activity. */
export function postHomeDismissal(sessionId: string): Promise<HomeDismissals> {
	return apiFetch("/api/home/dismissals", HomeDismissalsResponse, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({sessionId}),
	});
}
