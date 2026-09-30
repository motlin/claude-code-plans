import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";
import {sessionQueryKeys} from "./sessions";

const ArtifactSummarySchema = z.strictObject({
	url: z.string(),
	id: z.string(),
	kind: z.enum(["html", "docs"]),
	title: z.string(),
	description: z.string().nullable(),
	sourcePath: z.string().nullable(),
	sourceExists: z.boolean(),
	sourceModifiedAt: z.number().nullable(),
	audience: z.string().nullable(),
	firstSeenAt: z.number(),
	lastPublishedAt: z.number().nullable(),
	publishCount: z.number(),
	sessionId: z.string(),
	projectId: z.string(),
});

export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;

export const ArtifactListResponse = z.array(ArtifactSummarySchema);

export const artifactsQueryOptions = queryOptions({
	queryKey: ["artifacts"] as const,
	queryFn: ({signal}) => apiFetch("/api/artifacts", ArtifactListResponse, {signal}),
	staleTime: 30_000,
});

const SessionArtifactSchema = z.strictObject({
	url: z.string(),
	id: z.string(),
	kind: z.enum(["html", "docs"]),
	title: z.string(),
	/** The last publish came from a local HTML or Markdown file the source preview can show. */
	previewable: z.boolean(),
	/** When the session last published or opened it, in ms. */
	lastEventAt: z.number(),
});

export type SessionArtifact = z.infer<typeof SessionArtifactSchema>;

export const SessionArtifactListResponse = z.array(SessionArtifactSchema);

/** Keyed under the session detail so a session refresh also refetches its artifacts. */
export const sessionArtifactsQueryOptions = (sessionId: string) =>
	queryOptions({
		queryKey: sessionQueryKeys.artifacts(sessionId),
		queryFn: ({signal}) =>
			apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`, SessionArtifactListResponse, {signal}),
		staleTime: 30_000,
	});
