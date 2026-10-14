import {ReactQueryDevtools} from "@tanstack/react-query-devtools";
import {Agentation} from "agentation";
import {AGENTATION_ENDPOINT, agentationEndpoint} from "../lib/agentation-endpoint";
import {usePhoneSheet} from "../lib/use-phone-sheet";

/**
 * The dev server's floating buttons: the React Query devtools trigger and the Agentation toolbar.
 * Neither mounts on a phone, where they sit over the composer's + and send buttons.
 */
export function DevOverlays() {
	const phone = usePhoneSheet();
	if (phone) return null;
	return (
		<>
			<ReactQueryDevtools buttonPosition="bottom-left" />
			<Agentation
				endpoint={typeof window === "undefined" ? AGENTATION_ENDPOINT : agentationEndpoint(window.location)}
			/>
		</>
	);
}
