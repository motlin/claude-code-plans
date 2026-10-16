import {createFileRoute} from "@tanstack/react-router";
import {legacyTerminalsRedirect} from "../lib/legacy-terminals-redirect";

/** The Herdr section became Terminals; old links and bookmarks land on the same view there. */
export const redirectLegacyHerdr = legacyTerminalsRedirect("/herdr");

export const Route = createFileRoute("/herdr")({
	beforeLoad: redirectLegacyHerdr,
});
