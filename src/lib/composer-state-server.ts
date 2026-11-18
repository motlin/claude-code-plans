import {StatuslineSchema, SESSION_ID_PATTERN} from "./api/statusline";
import type {ComposerDefaults, ComposerServerState} from "./composer-state";
import type {AvailableModels} from "./model-restrictions";
import {isBypassPermissionsAllowed} from "./launch-options";
import {ClaudeSettingsSchema} from "./runtime-schemas";
import {type FastModeBlocked, fastModeBlockedReason, sessionFastMode} from "./session-fast-mode";

// The server side of the composer chin, reading settings.json and the statusline snapshot. Kept apart from
// `composer-state.ts` so the client, which only resolves the chin, doesn't download the settings schema.

export interface FastModeBlockDependencies
{
	/** The server's own environment, which a CLI launched from it inherits. */
	env?: Readonly<Record<string, string | undefined>>;
	/** The managed (policy) settings file. */
	readManagedSettings?: () => Promise<unknown>;
	/** Where `readManagedSettings` reads, for upstream's availableModels tooltip; defaults to this platform's. */
	managedSettingsPath?: string;
}

export interface ComposerStateDependencies extends FastModeBlockDependencies
{
	readStatusline(sessionId: string): Promise<
	{
		json: unknown;
		mtimeMs: number;
	}>;
	readSettings(): Promise<unknown>;
}

/** The user settings file every composer read uses, tildified as upstream shows it. */
const USER_SETTINGS_PATH = "~/.claude/settings.json";

type ClaudeSettings = NonNullable<Awaited<ReturnType<typeof readSettingsData>>>;

/** `fastModeBlockedReason` over settings.json `env` merged over the server env, and the managed policy. */
function fastModeBlocked(
	settingsEnv: Readonly<Record<string, string>> | undefined,
	managed: ClaudeSettings | null,
	dependencies: FastModeBlockDependencies,
): FastModeBlocked | null
{
	const policyFastMode = managed?.fastMode;
	return fastModeBlockedReason(
		{
			env:
			{
				...dependencies.env,
				...settingsEnv,
			},
			...(policyFastMode === undefined
				? {}
				:
					{
						policy:
						{
							fastMode: policyFastMode,
						},
					}),
		},
	);
}

async function readSettingsData(readSettings: () => Promise<unknown>)
{
	try
	{
		const parsed = ClaudeSettingsSchema.safeParse(await readSettings());
		return parsed.success ? parsed.data : null;
	}
	catch
	{
		// Missing or unreadable settings.json leaves the defaults unset.
		return null;
	}
}

/** Managed settings, or null when there are none. */
async function readManagedSettingsData(dependencies: FastModeBlockDependencies): Promise<ClaudeSettings | null>
{
	const {readManagedSettings} = dependencies;
	return readManagedSettings === undefined ? null : readSettingsData(readManagedSettings);
}

/**
 * The model and `availableModels` the CLI resolves, managed settings beating the user's. The allowlist keeps its
 * source and path for upstream's "Not in availableModels set by …" tooltip.
 */
function modelSettings(
	user: ClaudeSettings | null,
	managed: ClaudeSettings | null,
	dependencies: FastModeBlockDependencies,
):
{
	model: string | null;
	modelManaged: boolean;
	availableModels: AvailableModels | null;
}
{
	const managedModel = managed?.model;
	let availableModels: AvailableModels | null = null;
	if (managed?.availableModels !== undefined)
	{
		availableModels =
		{
			value: managed.availableModels,
			source: "managed",
			path: dependencies.managedSettingsPath ?? managedSettingsPath(process.platform),
		};
	}
	else if (user?.availableModels !== undefined)
	{
		availableModels =
		{
			value: user.availableModels,
			source: "user",
			path: USER_SETTINGS_PATH,
		};
	}
	return {
		model: managedModel ?? user?.model ?? null,
		modelManaged: managedModel !== undefined,
		availableModels,
	};
}

async function readSettingsDefaults(
	dependencies: ComposerStateDependencies,
): Promise<
	Pick<
		ComposerServerState,
		| "settingsDefaultMode"
		| "settingsModel"
		| "settingsModelManaged"
		| "settingsAvailableModels"
		| "settingsEffortLevel"
		| "settingsBypassPermissionsAllowed"
		| "settingsFastMode"
		| "settingsAdvisorModel"
		| "fastModeBlocked"
	>
>
{
	const [settings, managed] = await Promise.all([
		readSettingsData(async () => dependencies.readSettings()),
		readManagedSettingsData(dependencies),
	]);
	const {model, modelManaged, availableModels} = modelSettings(settings, managed, dependencies);
	const models =
	{
		settingsModel: model,
		settingsModelManaged: modelManaged,
		settingsAvailableModels: availableModels,
	};
	const blocked = fastModeBlocked(settings?.env, managed, dependencies);
	if (settings === null)
	{
		return {
			settingsDefaultMode: null,
			...models,
			settingsEffortLevel: null,
			settingsBypassPermissionsAllowed: false,
			settingsFastMode: false,
			settingsAdvisorModel: null,
			fastModeBlocked: blocked,
		};
	}
	return {
		settingsDefaultMode: settings.permissions?.defaultMode ?? null,
		...models,
		settingsEffortLevel: settings.effortLevel ?? null,
		settingsBypassPermissionsAllowed: isBypassPermissionsAllowed(
			{
				defaultMode: settings.permissions?.defaultMode,
				skipDangerousModePermissionPrompt: settings.skipDangerousModePermissionPrompt,
			},
		),
		settingsFastMode: sessionFastMode([], settings),
		settingsAdvisorModel: settings.advisorModel ?? null,
		fastModeBlocked: blocked,
	};
}

async function readStatuslineSnapshot(
	sessionId: string,
	dependencies: ComposerStateDependencies,
): Promise<Pick<ComposerServerState, "statusline" | "statuslineUpdatedAt">>
{
	if (SESSION_ID_PATTERN.test(sessionId))
	{
		try
		{
			const {json, mtimeMs} = await dependencies.readStatusline(sessionId);
			const parsed = StatuslineSchema.safeParse(json);
			if (parsed.success)
			{
				return {
					statusline: parsed.data,
					statuslineUpdatedAt: new Date(mtimeMs).toISOString(),
				};
			}
		}
		catch
		{
			// No statusline has been written for this session yet.
		}
	}
	return {
		statusline: null,
		statuslineUpdatedAt: null,
	};
}

export async function getComposerState(
	sessionId: string,
	dependencies: ComposerStateDependencies,
): Promise<ComposerServerState>
{
	const [settings, statusline] = await Promise.all([
		readSettingsDefaults(dependencies),
		readStatuslineSnapshot(sessionId, dependencies),
	]);
	return {
		...settings,
		...statusline,
	};
}

/** A project folder's settings files under `<cwd>/.claude/`. */
export type ReadProjectSettings = (file: "settings.local.json" | "settings.json") => Promise<unknown>;

/**
 * The folder's `permissions.defaultMode` as the CLI merges it: `settings.local.json` beats `settings.json`. Upstream
 * (ca8b34310 `xo`) ranks this repo default below the folder's remembered mode.
 */
async function readRepoDefaultMode(readProjectSettings: ReadProjectSettings | undefined): Promise<string | null>
{
	if (readProjectSettings === undefined) return null;
	const [local, shared] = await Promise.all([
		readSettingsData(async () => readProjectSettings("settings.local.json")),
		readSettingsData(async () => readProjectSettings("settings.json")),
	]);
	return local?.permissions?.defaultMode ?? shared?.permissions?.defaultMode ?? null;
}

export async function getComposerDefaults(
	readSettings: () => Promise<unknown>,
	blockDependencies: FastModeBlockDependencies = {},
	readProjectSettings?: ReadProjectSettings,
): Promise<ComposerDefaults>
{
	const [settings, managed, repoDefaultMode] = await Promise.all([
		readSettingsData(readSettings),
		readManagedSettingsData(blockDependencies),
		readRepoDefaultMode(readProjectSettings),
	]);
	const models = modelSettings(settings, managed, blockDependencies);
	const blocked = fastModeBlocked(settings?.env, managed, blockDependencies);
	if (settings === null)
	{
		return {
			...models,
			effortLevel: null,
			defaultMode: null,
			repoDefaultMode,
			bypassPermissionsAllowed: false,
			fastMode: false,
			fastModeBlocked: blocked,
		};
	}
	return {
		...models,
		effortLevel: settings.effortLevel ?? null,
		defaultMode: settings.permissions?.defaultMode ?? null,
		repoDefaultMode,
		bypassPermissionsAllowed: isBypassPermissionsAllowed(
			{
				defaultMode: settings.permissions?.defaultMode,
				skipDangerousModePermissionPrompt: settings.skipDangerousModePermissionPrompt,
			},
		),
		fastMode: sessionFastMode([], settings),
		fastModeBlocked: blocked,
	};
}

export interface ComposerDefaultsRequestDependencies
{
	readSettings: () => Promise<unknown>;
	blockDependencies: FastModeBlockDependencies;
	readJson: (path: string) => Promise<unknown>;
	/** The indexed projects' folders; only these may be asked about by `?cwd=`. */
	knownProjectPaths: () => Promise<readonly string[]>;
}

const DEFAULTS_HEADERS =
{
	"Cache-Control": "private, max-age=0, must-revalidate",
};

/** `GET /api/composer-defaults[?cwd=<project folder>]`: the user defaults, plus that folder's `defaultMode`. */
export async function handleComposerDefaultsRequest(
	request: Request,
	dependencies: ComposerDefaultsRequestDependencies,
): Promise<Response>
{
	const cwd = new URL(request.url).searchParams.get("cwd");
	if (cwd !== null && (!cwd.startsWith("/") || !(await dependencies.knownProjectPaths()).includes(cwd)))
	{
		return Response.json(
			{
				error: "Expected ?cwd=<a known project folder>",
			},
			{
				status: 400,
				headers: DEFAULTS_HEADERS,
			},
		);
	}
	const readProjectSettings: ReadProjectSettings | undefined =
		cwd === null ? undefined : async (file) => dependencies.readJson(`${cwd}/.claude/${file}`);
	const defaults = await getComposerDefaults(
		dependencies.readSettings,
		dependencies.blockDependencies,
		readProjectSettings,
	);
	return Response.json(
		defaults,
		{
			headers: DEFAULTS_HEADERS,
		},
	);
}

/** Where the CLI reads managed (policy) settings on each platform. */
export function managedSettingsPath(platform: NodeJS.Platform): string
{
	if (platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
	if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\managed-settings.json";
	return "/etc/claude-code/managed-settings.json";
}

/** The real server env and managed settings file, for the routes. */
export async function nodeFastModeBlockDependencies(): Promise<Required<FastModeBlockDependencies>>
{
	const {readFile} = await import("node:fs/promises");
	const path = managedSettingsPath(process.platform);
	return {
		env: process.env,
		readManagedSettings: async () => JSON.parse(await readFile(path, "utf-8")) as unknown,
		managedSettingsPath: path,
	};
}
