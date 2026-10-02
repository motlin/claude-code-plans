import type {ParsedLocation} from "@tanstack/react-router";

declare module "@tanstack/react-router" {
	interface HistoryState {
		sessionIdentity?: {sessionId: string; scrollKey: string; routeId: string; aliasRouteId?: string};
	}
}

/** Cosmetic identity replacements keep the original visit's scroll and launch measurement. */
export function sessionScrollKey(location: ParsedLocation, routeId: string): string {
	const carried = location.state.sessionIdentity;
	if (carried?.sessionId === routeId || carried?.aliasRouteId === routeId || carried?.routeId === routeId)
		return carried.scrollKey;
	return location.state.__TSR_key ?? location.href;
}
