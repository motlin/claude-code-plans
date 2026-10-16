import {createFileRoute} from "@tanstack/react-router";
import {legacyTerminalsRedirect} from "../lib/legacy-terminals-redirect";

/** The Tmux Windows page folded into Terminals, which lists the same tmux windows; old links land there. */
export const redirectLegacyTmux = legacyTerminalsRedirect("/tmux");

export const Route = createFileRoute("/tmux")({
	beforeLoad: redirectLegacyTmux,
});
