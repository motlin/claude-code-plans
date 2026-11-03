import {StatuslineSchema, SESSION_ID_PATTERN} from "./api/statusline";
import type {ComposerDefaults, ComposerServerState} from "./composer-state";
import {isBypassPermissionsAllowed} from "./launch-options";
import {ClaudeSettingsSchema} from "./runtime-schemas";
import {type FastModeBlocked, fastModeBlockedReason, sessionFastMode} from "./session-fast-mode";

// The server side of the composer chin, reading settings.json and the statusline snapshot. Kept apart from
// `composer-state.ts` so the client, which only resolves the chin, doesn't download the settings schema.

export interface FastModeBlockDependencies {
	/** The server's own environment, which a CLI launched from it inherits. */
	env?: Readonly<Record<string, string | undefined>>;
	/** The managed (policy) settings file. */
	readManagedSettings?: () => Promise<unknown>;
}

export interface ComposerStateDependencies extends FastModeBlockDependencies {
	readStatusline(sessionId: string): Promise<{json: unknown; mtimeMs: number}>;
	readSettings(): Promise<unknown>;
}

async function readPolicyFastMode(dependencies: FastModeBlockDependencies): Promise<boolean | undefined> {
	if (dependencies.readManagedSettings === undefined) return undefined;
	try {
		const parsed = ClaudeSettingsSchema.safeParse(await dependencies.readManagedSettings());
		return parsed.success ? parsed.data.fastMode : undefined;
	} catch {
		// No managed settings: no policy.
		return undefined;
	}
}

/** `fastModeBlockedReason` over settings.json `env` merged over the server env, and the managed policy. */
async function readFastModeBlocked(
	settingsEnv: Readonly<Record<string, string>> | undefined,
	dependencies: FastModeBlockDependencies,
): Promise<FastModeBlocked | null> {
	const policyFastMode = await readPolicyFastMode(dependencies);
	const blocked = fastModeBlockedReason({
		env: {...dependencies.env, ...settingsEnv},
		...(policyFastMode === undefined ? {} : {policy: {fastMode: policyFastMode}}),
	});
	if (blocked === null) return null;
	return blocked.reason === undefined ? {line: blocked.line} : {line: blocked.line, reason: blocked.reason};
}

async function readSettingsData(readSettings: () => Promise<unknown>) {
	try {
		const parsed = ClaudeSettingsSchema.safeParse(await readSettings());
		return parsed.success ? parsed.data : null;
	} catch {
		// Missing or unreadable settings.json leaves the defaults unset.
		return null;
	}
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
		| "fastModeBlocked"
	>
> {
	const settings = await readSettingsData(async () => dependencies.readSettings());
	const fastModeBlocked = await readFastModeBlocked(settings?.env, dependencies);
	if (settings === null) {
		return {
			settingsDefaultMode: null,
			settingsModel: null,
			settingsEffortLevel: null,
			settingsBypassPermissionsAllowed: false,
			settingsFastMode: false,
			fastModeBlocked,
		};
	}
	return {
		settingsDefaultMode: settings.permissions?.defaultMode ?? null,
		settingsModel: settings.model ?? null,
		settingsEffortLevel: settings.effortLevel ?? null,
		settingsBypassPermissionsAllowed: isBypassPermissionsAllowed({
			defaultMode: settings.permissions?.defaultMode,
			skipDangerousModePermissionPrompt: settings.skipDangerousModePermissionPrompt,
		}),
		settingsFastMode: sessionFastMode([], settings),
		fastModeBlocked,
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

export async function getComposerDefaults(
	readSettings: () => Promise<unknown>,
	blockDependencies: FastModeBlockDependencies = {},
): Promise<ComposerDefaults> {
	const settings = await readSettingsData(readSettings);
	const fastModeBlocked = await readFastModeBlocked(settings?.env, blockDependencies);
	if (settings === null) {
		return {
			model: null,
			effortLevel: null,
			defaultMode: null,
			bypassPermissionsAllowed: false,
			fastMode: false,
			fastModeBlocked,
		};
	}
	return {
		model: settings.model ?? null,
		effortLevel: settings.effortLevel ?? null,
		defaultMode: settings.permissions?.defaultMode ?? null,
		bypassPermissionsAllowed: isBypassPermissionsAllowed({
			defaultMode: settings.permissions?.defaultMode,
			skipDangerousModePermissionPrompt: settings.skipDangerousModePermissionPrompt,
		}),
		fastMode: sessionFastMode([], settings),
		fastModeBlocked,
	};
}

/** Where the CLI reads managed (policy) settings on each platform. */
export function managedSettingsPath(platform: NodeJS.Platform): string {
	if (platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
	if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\managed-settings.json";
	return "/etc/claude-code/managed-settings.json";
}

/** The real server env and managed settings file, for the routes. */
export async function nodeFastModeBlockDependencies(): Promise<Required<FastModeBlockDependencies>> {
	const {readFile} = await import("node:fs/promises");
	return {
		env: process.env,
		readManagedSettings: async () =>
			JSON.parse(await readFile(managedSettingsPath(process.platform), "utf-8")) as unknown,
	};
}
