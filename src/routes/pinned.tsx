import {pageTitle} from "../lib/route-title";
import {createFileRoute} from "@tanstack/react-router";
import {PinnedSessionsPage} from "../components/pinned-sessions-page";
import {PINNED_SESSIONS_TITLE} from "../lib/pinned-sessions";

export const Route = createFileRoute("/pinned")(
	{
		component: PinnedSessionsPage,
		head: () => (
		{
			meta: [pageTitle(PINNED_SESSIONS_TITLE)],
		}),
	},
);
