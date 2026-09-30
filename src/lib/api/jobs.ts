import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {JobChildKindSchema, JobStateSchema} from "../jobs";
import {apiFetch} from "./client";

const JobSchema = z.strictObject({
	id: z.string(),
	name: z.string(),
	intent: z.string(),
	state: JobStateSchema,
	detail: z.string(),
	needs: z.string().nullable(),
	result: z.string().nullable(),
	cwd: z.string(),
	createdAt: z.number(),
	updatedAt: z.number(),
	/** The job's session transcript, from `linkScanPath`; null when it has none. */
	sessionId: z.string().nullable(),
	projectId: z.string().nullable(),
	children: z.array(
		z.strictObject({
			id: z.string(),
			href: z.string(),
			kind: JobChildKindSchema,
			title: z.string().nullable(),
		}),
	),
	timeline: z.array(
		z.strictObject({
			at: z.number(),
			state: JobStateSchema,
			detail: z.string(),
			text: z.string(),
		}),
	),
});

export const JobListResponse = z.array(JobSchema);

export const jobsQueryOptions = queryOptions({
	queryKey: ["jobs"] as const,
	queryFn: ({signal}) => apiFetch("/api/jobs", JobListResponse, {signal}),
	staleTime: 30_000,
});
