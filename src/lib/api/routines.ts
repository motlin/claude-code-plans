import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {RoutineKindSchema, RoutineStatusSchema} from "../routines";
import {apiFetch} from "./client";

const RoutineSchema = z.strictObject({
	toolUseId: z.string(),
	recordUuid: z.string().nullable(),
	kind: RoutineKindSchema,
	routineId: z.string().nullable(),
	name: z.string().nullable(),
	schedule: z.string().nullable(),
	humanSchedule: z.string().nullable(),
	delaySeconds: z.number().nullable(),
	runOnceAt: z.number().nullable(),
	recurring: z.boolean(),
	durable: z.boolean(),
	prompt: z.string(),
	createdAt: z.number(),
	deletedAt: z.number().nullable(),
	sessionId: z.string(),
	projectId: z.string(),
	sessionTitle: z.string().nullable(),
	status: RoutineStatusSchema,
	/** When an active routine fires next; null once completed. */
	nextRunAt: z.number().nullable(),
});

export type Routine = z.infer<typeof RoutineSchema>;

export const RoutineListResponse = z.array(RoutineSchema);

export const routinesQueryOptions = queryOptions({
	queryKey: ["routines"] as const,
	queryFn: ({signal}) => apiFetch("/api/routines", RoutineListResponse, {signal}),
	staleTime: 30_000,
});
