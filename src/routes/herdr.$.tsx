import {createFileRoute} from "@tanstack/react-router";

/** Matches every `/herdr/…` subroute so the parent `/herdr` route's redirect to `/terminals/…` runs for it. */
export const Route = createFileRoute("/herdr/$")({});
