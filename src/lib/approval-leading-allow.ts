import {useSyncExternalStore} from "react";

/** Upstream's localStorage key for which allow option a permission card leads with. */
export const APPROVAL_LEADING_ALLOW_KEY = "epitaxy-approval-card-leading-allow";

/** "always" leads with the persistent option (upstream's default); "once" leads with Allow once. */
export type ApprovalLeadingAllow = "always" | "once";

const listeners = new Set<() => void>();

function readLeadingAllow(): ApprovalLeadingAllow {
	try {
		return localStorage.getItem(APPROVAL_LEADING_ALLOW_KEY) === "once" ? "once" : "always";
	} catch {
		return "always";
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	const onStorage = (event: StorageEvent) => {
		if (event.key === null || event.key === APPROVAL_LEADING_ALLOW_KEY) listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

/** Remembers the lead, as upstream does when the non-leading option is picked from the menu. */
export function storeLeadingAllow(lead: ApprovalLeadingAllow): void {
	try {
		localStorage.setItem(APPROVAL_LEADING_ALLOW_KEY, lead);
	} catch {
		// Blocked storage keeps the current lead for this page only.
	}
	for (const listener of listeners) listener();
}

/** The stored lead, "always" on the server, without storage, or for any other value. */
export function useLeadingAllow(): ApprovalLeadingAllow {
	return useSyncExternalStore(subscribe, readLeadingAllow, () => "always");
}
