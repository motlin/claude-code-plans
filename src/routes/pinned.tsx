import {pageTitle} from "../lib/route-title";
import {createFileRoute} from "@tanstack/react-router";
import {PINNED_SESSIONS_TITLE, PinnedSessionsPage} from "../components/pinned-sessions-page";

export const Route = createFileRoute("/pinned")({
	component: PinnedSessionsPage,
	head: () => ({
		meta: [pageTitle(PINNED_SESSIONS_TITLE)],
	}),
});
