import type {AutoDefaultOffer} from "./api/auto-default-offer";

export type AutoDefaultDialog =
	|
	  {
			kind: "notice";
	  }
	|
	  {
			kind: "nudge";
			/** The user's current default mode, offered as "Keep {label}". */
			mode: string;
	  };

/**
 * Which one-shot Auto dialog a home draft shows. The server answers for the user, policy and `.claude.json` layers;
 * this adds the draft's own: upstream's `folderChoice === undefined` (no remembered mode for the folder) and the CLI's
 * `TLo` refusal when a project or local settings layer sets `defaultMode`. The two are exclusive: the notice needs no
 * user default and the nudge needs one.
 */
export function autoDefaultDialogFor({
	offer,
	folderChoice,
	repoDefaultMode,
}: {
	offer: AutoDefaultOffer;
	folderChoice: string | undefined;
	repoDefaultMode: string | null;
}): AutoDefaultDialog | null
{
	if (folderChoice !== undefined || repoDefaultMode !== null) return null;
	if (offer.nudgeMode !== null)
		return {
			kind: "nudge",
			mode: offer.nudgeMode,
		};
	return offer.noticeEligible
		?
			{
				kind: "notice",
			}
		: null;
}
