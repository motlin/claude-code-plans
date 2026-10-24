import {type ComposerDefaults, getComposerDefaults, resolveComposerState} from "./composer-state";
import {EffortLevelSchema} from "./launch-options";
import {effortLevelShortLabels} from "./schema-choices";
import {setShellChinLabels, type ShellChinLabels} from "./shell-chin-store";

/** The mode, model and effort text the live home chin shows for these settings defaults. */
export function resolveShellChinLabels(defaults: ComposerDefaults | null): ShellChinLabels {
	const state = resolveComposerState({
		hookPermissionMode: null,
		jsonlPermissionMode: null,
		settingsDefaultMode: defaults?.defaultMode ?? null,
		statuslineModel: null,
		statuslineModelId: null,
		lastAssistantModel: null,
		lastAssistantUsage: null,
		lastAssistantEffort: null,
		fastMode: false,
		settingsModel: defaults?.model ?? null,
		settingsEffortLevel: defaults?.effortLevel ?? null,
		statusline: null,
		statuslineUpdatedAt: null,
	});
	const level = EffortLevelSchema.safeParse(state.effort.id);
	return {
		mode: state.mode?.label ?? "Manual",
		model: state.model,
		effort: level.success ? effortLevelShortLabels[level.data] : state.effort.id,
	};
}

/** A document request: anything but the JSON API, which never renders the shell. */
function rendersShell(request: Request): boolean {
	return request.method === "GET" && !new URL(request.url).pathname.startsWith("/api/");
}

/**
 * Re-reads settings.json before each page render so the hard-load fallback's
 * chin shows the defaults the live chin will, without the client fetching them.
 */
export function withShellChinLabels(
	fetch: (request: Request) => Response | Promise<Response>,
	readSettings: () => Promise<unknown>,
): (request: Request) => Promise<Response> {
	return async (request) => {
		if (rendersShell(request)) setShellChinLabels(resolveShellChinLabels(await getComposerDefaults(readSettings)));
		return fetch(request);
	};
}
