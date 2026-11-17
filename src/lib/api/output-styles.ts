import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
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

const jsonPost = (body: unknown, signal?: AbortSignal): RequestInit => (
{
	method: "POST",
	headers:
	{
		"Content-Type": "application/json",
	},
	body: JSON.stringify(body),
	...(signal === undefined
		? {}
		:
			{
				signal,
			}),
});

const OutputStyleNameCheckSchema = z.union([
	z.strictObject(
		{
			ok: z.literal(true),
		},
	),
	z.strictObject(
		{
			ok: z.literal(false),
			reason: z.enum(["exists", "invalid"]),
		},
	),
]);

/** Upstream's `validateNewOutputStyleName`: whether a user-chosen name is free and usable. */
export async function validateNewOutputStyleName(name: string): Promise<z.infer<typeof OutputStyleNameCheckSchema>>
{
	return apiFetch(
		"/api/output-styles/validate",
		OutputStyleNameCheckSchema,
		jsonPost(
			{
				name,
			},
		),
	);
}

/** Upstream's `createOutputStyle` outcomes; anything unknown reads as `draft_failed`. */
const OutputStyleCreateResultSchema = z.union([
	z.strictObject(
		{
			outcome: z.literal("created"),
			name: z.string(),
			path: z.string(),
			refreshed: z.boolean(),
			selected: z.boolean(),
		},
	),
	z.strictObject(
		{
			outcome: z.string(),
		},
	),
]);
export type OutputStyleCreateResponse = z.infer<typeof OutputStyleCreateResultSchema>;

/** Drafts and saves a style from a description; aborting `signal` cancels the draft. */
export async function createOutputStyle(
	description: string,
	name: string | undefined,
	signal: AbortSignal,
): Promise<OutputStyleCreateResponse>
{
	return apiFetch(
		"/api/output-styles",
		OutputStyleCreateResultSchema,
		jsonPost(
			name === undefined
				?
					{
						description,
					}
				:
					{
						description,
						name,
					},
			signal,
		),
	);
}
