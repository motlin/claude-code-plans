import {createFileRoute} from "@tanstack/react-router";
import {legacyTerminalPageRedirect} from "../lib/legacy-terminals-redirect";

/** The live terminal page moved to `/terminals/$sessionId`; old links and bookmarks land there. */
export const Route = createFileRoute("/terminals/terminal/$sessionId")({
	beforeLoad: legacyTerminalPageRedirect,
});
