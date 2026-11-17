import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";

/**
 * The CLI-side half of upstream's two one-shot Auto dialogs, read from the CLI's own files: `noticeEligible` is the
 * CLI's `auto-mode-default` startup notice gate (onboarded, `hasSeenAutoDefaultNotice` unset, no user or policy
 * `defaultMode`, so the CLI starts in Auto by fallback); `nudgeMode` is CLI `TLo`, the user's non-Auto default mode
 * the nudge offers to replace, or null.
 */
const AutoDefaultOfferResponse = z
	.object(
		{
			noticeEligible: z.boolean(),
			nudgeMode: z.string().nullable(),
		},
	)
	.strict();
export type AutoDefaultOffer = z.infer<typeof AutoDefaultOfferResponse>;

/** The notice is marked seen when shown; the nudge records its answer (CLI `ALo`). */
export const AutoDefaultOfferBodySchema = z.discriminatedUnion("surface", [
	z
		.object(
			{
				surface: z.literal("notice"),
			},
		)
		.strict(),
	z
		.object(
			{
				surface: z.literal("nudge"),
				choice: z.enum(["accept", "decline"]),
			},
		)
		.strict(),
]);
export type AutoDefaultOfferBody = z.infer<typeof AutoDefaultOfferBodySchema>;

const PATH = "/api/auto-default-offer";

export const autoDefaultOfferQueryOptions = queryOptions(
	{
		queryKey: ["auto-default-offer"] as const,
		queryFn: async () => apiFetch(PATH, AutoDefaultOfferResponse),
		staleTime: Infinity,
	},
);

export async function postAutoDefaultOffer(body: AutoDefaultOfferBody): Promise<AutoDefaultOffer>
{
	return apiFetch(
		PATH,
		AutoDefaultOfferResponse,
		{
			method: "POST",
			headers:
			{
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		},
	);
}
