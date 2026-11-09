import {queryOptions} from "@tanstack/react-query";
import {ComposerDefaultsResponse} from "../composer-state";
import {apiFetch} from "./client";

export const composerDefaultsQueryOptions = queryOptions({
	queryKey: ["composer-defaults"] as const,
	queryFn: async () => apiFetch("/api/composer-defaults", ComposerDefaultsResponse),
});

/** The defaults with `cwd`'s project `defaultMode` (`repoDefaultMode`); upstream ranks it below the folder memory. */
export function composerFolderDefaultsQueryOptions(cwd: string | undefined) {
	return queryOptions({
		queryKey: ["composer-defaults", "folder", cwd] as const,
		queryFn: async () =>
			apiFetch(
				`/api/composer-defaults?${new URLSearchParams({cwd: cwd ?? ""}).toString()}`,
				ComposerDefaultsResponse,
			),
		enabled: cwd !== undefined,
	});
}
