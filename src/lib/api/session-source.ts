import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";
import {sessionQueryKeys} from "./sessions";

const RawJsonlLineSchema = z.object({
	raw: z.string(),
	uuid: z.string().optional(),
	lineIndex: z.number(),
	parseError: z.boolean().optional(),
});

const RawWindowSchema = z.object({
	before: z.array(RawJsonlLineSchema),
	focal: RawJsonlLineSchema,
	after: z.array(RawJsonlLineSchema),
});

const PairedResultSchema = z.object({
	resultEntry: RawJsonlLineSchema,
	resultLineIndex: z.number(),
	toolUseId: z.string(),
});

export const SessionSourceResponse = z
	.object({
		window: RawWindowSchema,
		parsedBlocksJson: z.string(),
		parsedBlocksCount: z.number(),
		paired: PairedResultSchema.nullable(),
		sessionTitle: z.string(),
		knownUuids: z.array(z.string()),
		projectId: z.string().optional(),
	})
	.nullable();

export const sessionSourceQueryOptions = (sessionId: string, uuid: string, contextN = 5) =>
	queryOptions({
		queryKey: [...sessionQueryKeys.all(), sessionId, "source", uuid, contextN] as const,
		queryFn: () =>
			apiFetch(
				`/api/sessions/${encodeURIComponent(sessionId)}/source/${encodeURIComponent(uuid)}?context=${contextN}`,
				SessionSourceResponse,
			),
		staleTime: Infinity,
		gcTime: Infinity,
	});
