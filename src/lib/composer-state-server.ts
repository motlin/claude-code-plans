import {StatuslineSchema, SESSION_ID_PATTERN} from "./api/statusline";
import type {ComposerDefaults, ComposerServerState} from "./composer-state";
import {isBypassPermissionsAllowed} from "./launch-options";
import {ClaudeSettingsSchema} from "./runtime-schemas";
import {sessionFastMode} from "./session-fast-mode";

// The server side of the composer chin, reading settings.json and the statusline snapshot. Kept apart from
// `composer-state.ts` so the client, which only resolves the chin, doesn't download the settings schema.

export interface ComposerStateDependencies {
	readStatusline(sessionId: string): Promise<{json: unknown; mtimeMs: number}>;
	readSettings(): Promise<unknown>;
}

async function readSettingsDefaults(
	dependencies: ComposerStateDependencies,
): Promise<
	Pick<
		ComposerServerState,
		| "settingsDefaultMode"
		| "settingsModel"
		| "settingsEffortLevel"
		| "settingsBypassPermissionsAllowed"
		| "settingsFastMode"
	>
> {
	try {
		const parsed = ClaudeSettingsSchema.safeParse(await dependencies.readSettings());
		if (parsed.success) {
			return {
				settingsDefaultMode: parsed.data.permissions?.defaultMode ?? null,
				settingsModel: parsed.data.model ?? null,
				settingsEffortLevel: parsed.data.effortLevel ?? null,
				settingsBypassPermissionsAllowed: isBypassPermissionsAllowed({
					defaultMode: parsed.data.permissions?.defaultMode,
					skipDangerousModePermissionPrompt: parsed.data.skipDangerousModePermissionPrompt,
				}),
				settingsFastMode: sessionFastMode([], parsed.data),
			};
		}
	} catch {
		// Missing or unreadable settings.json leaves the defaults unset.
	}
	return {
		settingsDefaultMode: null,
		settingsModel: null,
		settingsEffortLevel: null,
		settingsBypassPermissionsAllowed: false,
		settingsFastMode: false,
	};
}

async function readStatuslineSnapshot(
	sessionId: string,
	dependencies: ComposerStateDependencies,
): Promise<Pick<ComposerServerState, "statusline" | "statuslineUpdatedAt">> {
	if (SESSION_ID_PATTERN.test(sessionId)) {
		try {
			const {json, mtimeMs} = await dependencies.readStatusline(sessionId);
			const parsed = StatuslineSchema.safeParse(json);
			if (parsed.success) {
				return {statusline: parsed.data, statuslineUpdatedAt: new Date(mtimeMs).toISOString()};
			}
		} catch {
			// No statusline has been written for this session yet.
		}
	}
	return {statusline: null, statuslineUpdatedAt: null};
}

export async function getComposerState(
	sessionId: string,
	dependencies: ComposerStateDependencies,
): Promise<ComposerServerState> {
	const [settings, statusline] = await Promise.all([
		readSettingsDefaults(dependencies),
		readStatuslineSnapshot(sessionId, dependencies),
	]);
	return {...settings, ...statusline};
}

export async function getComposerDefaults(readSettings: () => Promise<unknown>): Promise<ComposerDefaults> {
	try {
		const parsed = ClaudeSettingsSchema.safeParse(await readSettings());
		if (parsed.success) {
			return {
				model: parsed.data.model ?? null,
				effortLevel: parsed.data.effortLevel ?? null,
				defaultMode: parsed.data.permissions?.defaultMode ?? null,
				bypassPermissionsAllowed: isBypassPermissionsAllowed({
					defaultMode: parsed.data.permissions?.defaultMode,
					skipDangerousModePermissionPrompt: parsed.data.skipDangerousModePermissionPrompt,
				}),
				fastMode: sessionFastMode([], parsed.data),
			};
		}
	} catch {
		// Missing or unreadable settings.json leaves the defaults unset.
	}
	return {model: null, effortLevel: null, defaultMode: null, bypassPermissionsAllowed: false, fastMode: false};
}
