import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import type {ContextBreakdown} from "../context-breakdown";
import {apiFetch} from "./client";
import {sessionQueryKeys} from "./sessions";

const ContextBreakdownSchema: z.ZodType<ContextBreakdown> = z.object({
	categories: z.array(
		z.object({name: z.string(), tokens: z.number(), kind: z.enum(["used", "free", "buffer", "deferred"])}),
	),
	totalTokens: z.number(),
	rawMaxTokens: z.number(),
	percentage: z.number(),
	mcpTools: z.array(z.object({name: z.string(), serverName: z.string(), tokens: z.number()})),
	memoryFiles: z.array(z.object({path: z.string(), type: z.string(), tokens: z.number()})),
	agents: z.array(z.object({agentType: z.string(), source: z.string(), tokens: z.number()})),
	fetchedAt: z.string(),
	source: z.enum(["context-command", "mod"]),
});

const ContextBreakdownResponse = ContextBreakdownSchema.nullable();

/** The ccb-context-mirror mod's breakdown for a session; `session:context-breakdown-changed` invalidates it. */
export const sessionContextBreakdownQueryOptions = (id: string) =>
	queryOptions({
		queryKey: sessionQueryKeys.contextBreakdown(id),
		queryFn: async () =>
			apiFetch(`/api/sessions/${encodeURIComponent(id)}/context-breakdown`, ContextBreakdownResponse),
		staleTime: Infinity,
	});
