import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {HookStatusResponse} from "../../lib/api/hooks";
import {asRecord} from "../../lib/narrow";

export const Route = createFileRoute("/api/hooks/status")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {homedir} = await import("node:os");
				const {join} = await import("node:path");
				const {readFile} = await import("node:fs/promises");
				const {hookInstallStatus} = await import("../../lib/hook-config");
				const settingsPath = join(homedir(), ".claude", "settings.json");

				let existing: Record<string, unknown> = {};
				try {
					const raw = await readFile(settingsPath, "utf-8");
					existing = asRecord(JSON.parse(raw)) ?? {};
				} catch {
					// No readable settings file: nothing is installed.
				}

				const hooks = asRecord(existing["hooks"]);
				return Response.json(HookStatusResponse.parse({...hookInstallStatus(hooks), settingsPath}), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
