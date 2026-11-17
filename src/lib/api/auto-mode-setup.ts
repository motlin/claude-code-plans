import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";

/** The CLI's auto-mode setup state (`auto-mode-setup-state.ts`), plus upstream's auto-default flag and history length. */
const AutoModeSetupResponse = z
	.object(
		{
			/** The CLI offers `/auto-mode-setup` (`envOnboarding`) and the skill isn't turned off. */
			offered: z.boolean(),
			/** A settings layer has a non-empty `autoMode.environment`. */
			setupComplete: z.boolean(),
			/** `.claude.json` `autoModeEnvSetup.denials`, the CLI's classifier denial count. */
			denials: z.number(),
			/** The CLI nudge's "Don't show again". */
			dismissed: z.boolean(),
			/** The CLI nudge's "Not now" holds it off until this time (ms), or 0. */
			snoozedUntil: z.number(),
			/** Upstream's `autoIsDefault` (`ccd_auto_default_mode`), the consent guard's mapping. */
			autoModeIsDefault: z.boolean(),
			sessionHistoryCount: z.number(),
		},
	)
	.strict();
export type AutoModeSetup = z.infer<typeof AutoModeSetupResponse>;
export type AutoModeSetupState = Omit<AutoModeSetup, "autoModeIsDefault" | "sessionHistoryCount">;

/** The state with `cwd`'s project and local settings layers, or the user layer alone without one. */
export function autoModeSetupQueryOptions(cwd: string | undefined)
{
	return queryOptions(
		{
			queryKey: ["auto-mode-setup", cwd ?? null] as const,
			queryFn: async () =>
				apiFetch(
					cwd === undefined
						? "/api/auto-mode-setup"
						: `/api/auto-mode-setup?${new URLSearchParams(
								{
									cwd,
								},
							).toString()}`,
					AutoModeSetupResponse,
				),
		},
	);
}
