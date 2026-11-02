import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";

/** What the permission mode guard reads: the CLI's auto opt-in and consent, and the per-workspace Bypass acks. */
const PermissionModeConsentResponse = z
	.object(
		{
			/** Upstream's `autoIsDefault`: settings `permissions.defaultMode` is "auto" or `skipAutoPermissionPrompt` is set. */
			autoModeIsDefault: z.boolean(),
			/** The CLI's `hasSeenAutoModeEntryWarning` in `.claude.json`. */
			autoConsented: z.boolean(),
			acks: z.array(z.string()),
		},
	)
	.strict();
export type PermissionModeConsent = z.infer<typeof PermissionModeConsentResponse>;

export const PermissionModeConsentBodySchema = z
	.object(
		{
			mode: z.enum(["auto", "bypassPermissions"]),
			workspace: z.string(),
		},
	)
	.strict();
export type PermissionModeConsentBody = z.infer<typeof PermissionModeConsentBodySchema>;

const PATH = "/api/permission-mode-consent";

export const permissionModeConsentQueryOptions = queryOptions(
	{
		queryKey: ["permission-mode-consent"] as const,
		queryFn: async () => apiFetch(PATH, PermissionModeConsentResponse),
	},
);

/** Store a confirmed Auto consent or Bypass ack. */
export async function postPermissionModeConsent(body: PermissionModeConsentBody): Promise<PermissionModeConsent>
{
	return apiFetch(
		PATH,
		PermissionModeConsentResponse,
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
