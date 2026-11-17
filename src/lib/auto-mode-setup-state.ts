import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import type {AutoModeSetup, AutoModeSetupState} from "./api/auto-mode-setup";
import {defaultCliConfigDir, readCliConfig} from "./cli-global-config";
import {readAutoModeIsDefault} from "./permission-mode-consent-server";

/*
 * Upstream's auto-mode setup state (c5cd1b4dc `sr`/`vr`/`yr`), read from the CLI's own files the way CLI 2.1.319 reads
 * them for its `/auto-mode-setup` wizard and its terminal nudge `dO()`:
 * - offered: `cachedGrowthBookFeatures.tengu_auto_mode_config.envOnboarding` and the skill not turned off.
 * - setupComplete: a non-empty `autoMode.environment` in any settings layer (CLI `rP()?.environment?.length > 0`).
 * - denials, dismissed, snooze: `.claude.json` `autoModeEnvSetup {denials, dismissed, dismissedAt}`, where the nudge's
 *   "Not now" stamps `dismissedAt` and holds it off for seven days.
 */

const AUTO_SETUP_SNOOZE_MS = 604_800_000;

const SettingsSchema = z.looseObject(
	{
		skillOverrides: z.record(z.string(), z.unknown()).optional().catch(undefined),
		autoMode: z
			.looseObject(
				{
					environment: z.array(z.unknown()).optional().catch(undefined),
				},
			)
			.optional()
			.catch(undefined),
	},
);

const ClaudeJsonSchema = z.looseObject(
	{
		autoModeEnvSetup: z
			.looseObject(
				{
					denials: z.number().optional().catch(undefined),
					dismissed: z.boolean().optional().catch(undefined),
					dismissedAt: z.number().optional().catch(undefined),
				},
			)
			.optional()
			.catch(undefined),
		cachedGrowthBookFeatures: z
			.looseObject(
				{
					tengu_auto_mode_config: z
						.looseObject(
							{
								envOnboarding: z.unknown(),
							},
						)
						.optional()
						.catch(undefined),
				},
			)
			.optional()
			.catch(undefined),
	},
);

function settingsOf(raw: unknown): z.infer<typeof SettingsSchema> | null
{
	const parsed = SettingsSchema.safeParse(raw);
	return parsed.success ? parsed.data : null;
}

export function readAutoModeSetupState({
	claudeJson,
	userSettings,
	projectSettings,
	localSettings,
}: {
	claudeJson: unknown;
	userSettings: unknown;
	projectSettings?: unknown;
	localSettings?: unknown;
}): AutoModeSetupState
{
	const parsedConfig = ClaudeJsonSchema.safeParse(claudeJson);
	const config = parsedConfig.success ? parsedConfig.data : null;
	const user = settingsOf(userSettings);
	const layers = [user, settingsOf(projectSettings), settingsOf(localSettings)];
	const envSetup = config?.autoModeEnvSetup;
	const dismissedAt = envSetup?.dismissedAt;
	return {
		offered:
			config?.cachedGrowthBookFeatures?.tengu_auto_mode_config?.envOnboarding === true &&
			user?.skillOverrides?.["auto-mode-setup"] !== "off",
		setupComplete: layers.some((layer) => (layer?.autoMode?.environment?.length ?? 0) > 0),
		denials: envSetup?.denials ?? 0,
		dismissed: envSetup?.dismissed === true,
		snoozedUntil: dismissedAt === undefined ? 0 : dismissedAt + AUTO_SETUP_SNOOZE_MS,
	};
}

export interface AutoModeSetupDependencies
{
	/** Holds the user settings.json. */
	claudeDir: string;
	/** Holds the CLI's `.claude.json`. */
	configDir: string;
	/** The indexed projects' folders; only these may be asked about by `?cwd=`. */
	knownProjectPaths: () => Promise<readonly string[]>;
	/** Upstream's session history length (shared-m-8 `fuS()`): every indexed session. */
	sessionHistoryCount: () => number;
	readManagedSettings: () => Promise<unknown>;
}

const NO_STORE =
{
	"Cache-Control": "private, max-age=0, must-revalidate",
};

async function readJson(path: string): Promise<unknown>
{
	try
	{
		return JSON.parse(await readFile(path, "utf-8")) as unknown;
	}
	catch
	{
		return null;
	}
}

/** `GET /api/auto-mode-setup[?cwd=<project folder>]`: the setup state, with that folder's settings layers. */
export async function handleAutoModeSetupGet(
	request: Request,
	dependencies: AutoModeSetupDependencies,
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
				headers: NO_STORE,
			},
		);
	}
	const [claudeJson, userSettings, projectSettings, localSettings, autoModeIsDefault] = await Promise.all([
		readCliConfig(dependencies.configDir),
		readJson(join(dependencies.claudeDir, "settings.json")),
		cwd === null ? null : readJson(join(cwd, ".claude", "settings.json")),
		cwd === null ? null : readJson(join(cwd, ".claude", "settings.local.json")),
		readAutoModeIsDefault(dependencies),
	]);
	const body: AutoModeSetup =
	{
		...readAutoModeSetupState(
			{
				claudeJson,
				userSettings,
				projectSettings,
				localSettings,
			},
		),
		autoModeIsDefault,
		sessionHistoryCount: dependencies.sessionHistoryCount(),
	};
	return Response.json(
		body,
		{
			headers: NO_STORE,
		},
	);
}

/** The real settings dir, CLI config dir, managed settings and index, for the route. */
export async function nodeAutoModeSetupDependencies(): Promise<AutoModeSetupDependencies>
{
	const [
		{defaultClaudeDir},
		{getDb},
		{listFileSearchProjectPathsFromDb, countSessionHistoryFromDb},
		{nodeFastModeBlockDependencies},
	] = await Promise.all([
		import("./settings-file"),
		import("./db"),
		import("./db/queries"),
		import("./composer-state-server"),
	]);
	return {
		readManagedSettings: (await nodeFastModeBlockDependencies()).readManagedSettings,
		claudeDir: defaultClaudeDir(),
		configDir: defaultCliConfigDir(),
		knownProjectPaths: async () => Promise.resolve(listFileSearchProjectPathsFromDb(getDb().index)),
		sessionHistoryCount: () => countSessionHistoryFromDb(getDb().index),
	};
}
