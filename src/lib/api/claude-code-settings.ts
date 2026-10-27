import {queryOptions} from "@tanstack/react-query";
import {
	type ClaudeCodeSettingKey,
	ClaudeCodeSettingsStateSchema,
	type ClaudeCodeSettingsState,
} from "../claude-code-settings-schema";
import {apiFetch, resolveUrl} from "./client";

const URL = "/api/claude-code-settings";

export const claudeCodeSettingsQueryOptions = queryOptions({
	queryKey: ["claude-code-settings"] as const,
	queryFn: async () => apiFetch(URL, ClaudeCodeSettingsStateSchema),
	staleTime: 0,
});

/**
 * POST one allow-listed key (undefined deletes it). Resolves the new state, or null when the server
 * refused the write (a stale mtime, an invalid value) or the request failed.
 */
export async function postClaudeCodeSetting(patch: {
	key: ClaudeCodeSettingKey;
	value: string | boolean | undefined;
	expectedMtimeMs: number | null;
}): Promise<ClaudeCodeSettingsState | null> {
	try {
		const response = await fetch(resolveUrl(URL), {
			method: "POST",
			credentials: "same-origin",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify(patch),
		});
		if (!response.ok) return null;
		const parsed = ClaudeCodeSettingsStateSchema.safeParse(await response.json());
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
