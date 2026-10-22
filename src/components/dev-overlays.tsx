import {ReactQueryDevtools} from "@tanstack/react-query-devtools";
import {Agentation} from "agentation";
import {AGENTATION_ENDPOINT, agentationEndpoint} from "../lib/agentation-endpoint";
import {useHealthyAgentationEndpoint} from "../lib/agentation-health";
import {usePhoneSheet} from "../lib/use-phone-sheet";

/**
 * The dev server's floating buttons: the React Query devtools trigger and the Agentation toolbar.
 * Neither mounts on a phone, where they sit over the composer's + and send buttons. The toolbar gets
 * its endpoint only once a health probe succeeds, since with an endpoint it polls `/health` every 10s.
 */
export function DevOverlays() {
	const phone = usePhoneSheet();
	const endpoint = useHealthyAgentationEndpoint(
		typeof window === "undefined" ? AGENTATION_ENDPOINT : agentationEndpoint(window.location),
	);
	if (phone) return null;
	return (
		<>
			<ReactQueryDevtools buttonPosition="bottom-left" />
			<Agentation {...(endpoint === undefined ? {} : {endpoint})} />
		</>
	);
}
