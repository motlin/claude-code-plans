import {type TrackedPromise, trackFulfillment} from "../lib/tracked-promise";

type SendRejectedCardModule = typeof import("./send-rejected-card");

// The card and its Base UI Collapsible stay off the home page's cold load until a launch starts (or the page idles).
let cardModule: TrackedPromise<SendRejectedCardModule> | undefined;

/** The card's one module download, shared by its lazy boundary and the home dock's warm-ups. */
// oxlint-disable-next-line typescript/promise-function-async -- returns the one cached download, which use() needs to be stable
export function loadSendRejectedCard(): Promise<SendRejectedCardModule>
{
	cardModule ??= trackFulfillment(
		import("./send-rejected-card").catch((error: unknown) =>
		{
			// A failed download is retried on the next render of the card.
			cardModule = undefined;
			throw error;
		}),
	);
	return cardModule;
}
