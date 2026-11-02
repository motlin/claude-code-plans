import {pageTitle} from "../lib/route-title";
import {createFileRoute} from "@tanstack/react-router";
import {PinnedSessionsPage} from "../components/pinned-sessions-page";
import {PINNED_SESSIONS_TITLE} from "../lib/pinned-sessions";

/** Pre-pin URL, kept so old links and bookmarks still land on the pinned sessions page. */
export const Route = createFileRoute("/starred")(
	{
		component: PinnedSessionsPage,
		head: () => (
		{
			meta: [pageTitle(PINNED_SESSIONS_TITLE)],
		}),
	},
);
