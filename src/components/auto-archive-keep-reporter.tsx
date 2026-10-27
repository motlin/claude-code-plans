import {useRouterState} from "@tanstack/react-router";
import {useEffect, useMemo} from "react";
import {resolveUrl} from "../lib/api/client";
import {keepClientIds, lazyStorage, openSessionIdsFromMatches} from "../lib/auto-archive-keep-client";
import {usePins} from "../lib/pin-store";

/** Re-report well inside the server's 30-minute open lease, even from a throttled background tab. */
const REPORT_INTERVAL_MS = 5 * 60 * 1000;

function sendKeepReport(report: {browserId: string; tabId: string; pinnedIds: string[]; openIds: string[]}) {
	void fetch(resolveUrl("/api/auto-archive/keep"), {
		method: "PUT",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(report),
	}).catch(() => {
		// The next report retries; the server keeps the last one it got.
	});
}

/**
 * Tells the server which sessions this tab must keep out of Archive inactive sessions: the
 * browser's pins (only localStorage knows them) and the sessions the tab has open.
 */
export function AutoArchiveKeepReporter() {
	const {pinnedIds} = usePins();
	// A string, so the selection only changes when the open sessions do.
	const openKey = useRouterState({
		select: (state) => openSessionIdsFromMatches(state.matches).join("\n"),
	});
	const ids = useMemo(
		() =>
			keepClientIds(
				lazyStorage(() => window.localStorage),
				lazyStorage(() => window.sessionStorage),
			),
		[],
	);

	useEffect(() => {
		if (import.meta.env.MODE === "test") return undefined;
		const report = {...ids, pinnedIds, openIds: openKey === "" ? [] : openKey.split("\n")};
		sendKeepReport(report);
		const timer = setInterval(() => {
			sendKeepReport(report);
		}, REPORT_INTERVAL_MS);
		return () => {
			clearInterval(timer);
		};
	}, [ids, pinnedIds, openKey]);
	return null;
}
