import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/composer-defaults")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {join} = await import("node:path");
				const {homedir} = await import("node:os");
				const {readFile} = await import("node:fs/promises");
				const {getComposerDefaults} = await import("../../lib/composer-state");
				const defaults = await getComposerDefaults(
					async () =>
						JSON.parse(await readFile(join(homedir(), ".claude", "settings.json"), "utf-8")) as unknown,
				);
				return Response.json(defaults, {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
