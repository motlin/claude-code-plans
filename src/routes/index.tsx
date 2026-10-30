import {createFileRoute, useNavigate} from "@tanstack/react-router";
import {useCallback} from "react";
import {HomeComposer} from "../components/home/home-composer";
import {HomeLanding} from "../components/home/home-landing";
import {artifactTemplatePrompt, isArtifactTemplateSlug, type ArtifactTemplateSlug} from "../lib/artifact-templates";

export const Route = createFileRoute("/")({
	component: Home,
	staticData: {fullBleed: true, tileShell: "home"},
	validateSearch: validateHomeSearch,
	head: () => ({
		meta: [{title: "Claude Code Browser"}],
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

/** The home composer, prefilled with a template's starter prompt when home opens with `?create=`. Nothing is sent. */
export function HomeDock() {
	const {create} = Route.useSearch();
	const navigate = useNavigate();
	const dropCreate = useCallback(() => {
		void navigate({to: "/", search: {}, replace: true});
	}, [navigate]);
	return (
		<HomeComposer
			prefill={create === undefined ? undefined : artifactTemplatePrompt(create)}
			onPrefillApplied={dropCreate}
		/>
	);
}
