import {createFileRoute} from "@tanstack/react-router";
import {PluginDetailResponse} from "../../lib/api/customize";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

export const Route = createFileRoute("/api/customize/plugins/$pluginId")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {pluginId: string}}) => {
				const {listPlugins} = await import("../../lib/plugins");
				const {readPluginDetail} = await import("../../lib/customize/plugins");
				const plugin = (await listPlugins()).find((candidate) => candidate.id === params.pluginId);
				if (plugin === undefined) {
					return Response.json(
						{error: "Plugin not found"},
						{status: 404, headers: {"Cache-Control": PRIVATE_NO_CACHE}},
					);
				}
				return Response.json(PluginDetailResponse.parse(await readPluginDetail(plugin)), {
					headers: {"Cache-Control": PRIVATE_NO_CACHE},
				});
			},
		}),
	},
});
