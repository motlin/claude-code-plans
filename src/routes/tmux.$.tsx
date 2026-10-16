import {createFileRoute} from "@tanstack/react-router";

/** Matches every `/tmux/…` subroute so the parent `/tmux` route's redirect to `/terminals/…` runs for it. */
export const Route = createFileRoute("/tmux/$")({});
