import {createFileRoute} from "@tanstack/react-router";
import {PINNED_SESSIONS_TITLE, PinnedSessionsPage} from "../components/pinned-sessions-page";

/** Pre-pin URL, kept so old links and bookmarks still land on the pinned sessions page. */
export const Route = createFileRoute("/starred")({
	component: PinnedSessionsPage,
	head: () => ({
		meta: [{title: PINNED_SESSIONS_TITLE}],
	}),
});
