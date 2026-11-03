import {pageTitle} from "../lib/route-title";
import {createFileRoute} from "@tanstack/react-router";
import {HomeDock} from "../components/home/home-dock";
import {HomeLanding} from "../components/home/home-landing";
import {isArtifactTemplateSlug, type ArtifactTemplateSlug} from "../lib/artifact-templates";

export const Route = createFileRoute("/")({
	component: Home,
	staticData: {fullBleed: true, tileShell: "home"},
	validateSearch: validateHomeSearch,
	head: () => ({
		meta: [pageTitle("Claude Code Browser")],
	}),
});

/** `?create=` is upstream's "Make something new" template link: it prefills the composer once, then drops. */
export function validateHomeSearch(search: Record<string, unknown>): {create?: ArtifactTemplateSlug} {
	const create = search["create"];
	return isArtifactTemplateSlug(create) ? {create} : {};
}

function Home() {
	return <HomeLanding dock={<HomeDock />} />;
}
