import {useNavigate, useSearch} from "@tanstack/react-router";
import {useCallback} from "react";
import {artifactTemplatePrompt} from "../../lib/artifact-templates";
import {HomeComposer} from "./home-composer";

/**
 * The home composer, prefilled with a template's starter prompt when home opens with `?create=`. Nothing is sent.
 * It lives outside the route file so the composer joins the home route's split component chunk instead of the route
 * tree every page loads.
 */
export function HomeDock()
{
	// Not strict: tests mount the home route under their own route ids.
	const {create} = useSearch(
		{
			strict: false,
		},
	);
	const navigate = useNavigate();
	const dropCreate = useCallback(() =>
	{
		void navigate(
			{
				to: "/",
				search: {},
				replace: true,
			},
		);
	}, [navigate]);
	return (
		<HomeComposer
			prefill={create === undefined ? undefined : artifactTemplatePrompt(create)}
			onPrefillApplied={dropCreate}
		/>
	);
}
