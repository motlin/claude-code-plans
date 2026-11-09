import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/composer-defaults")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({request}: {request: Request}) => {
				const {join} = await import("node:path");
				const {homedir} = await import("node:os");
				const {readFile} = await import("node:fs/promises");
				const {handleComposerDefaultsRequest, nodeFastModeBlockDependencies} =
					await import("../../lib/composer-state-server");
				const readJson = async (path: string) => JSON.parse(await readFile(path, "utf-8")) as unknown;
				return handleComposerDefaultsRequest(request, {
					readSettings: async () => readJson(join(homedir(), ".claude", "settings.json")),
					blockDependencies: await nodeFastModeBlockDependencies(),
					readJson,
					knownProjectPaths: async () => {
						const [{getDb}, {listFileSearchProjectPathsFromDb}] = await Promise.all([
							import("../../lib/db"),
							import("../../lib/db/queries"),
						]);
						return listFileSearchProjectPathsFromDb(getDb().index);
					},
				});
			},
		}),
	},
});
