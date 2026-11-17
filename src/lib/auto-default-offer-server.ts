import {type AutoDefaultOffer, AutoDefaultOfferBodySchema, type AutoDefaultOfferBody} from "./api/auto-default-offer";
import {defaultCliConfigDir, readCliConfig, setCliConfigFlag} from "./cli-global-config";
import {isRecord} from "./narrow";
import {ClaudeSettingsSchema} from "./runtime-schemas";
import {rejectCrossSite} from "./same-origin-guard";
import {editSettingsText, loadSettings, settingsPathIn, writeSettingsAtomically} from "./settings-file";

/*
 * Upstream's Auto default notice and nudge, keyed off the CLI's own state so neither the browser nor a terminal shows
 * either one twice. The CLI (2.1.319+) shows the notice at startup when it lands in Auto by fallback and writes
 * `hasSeenAutoDefaultNotice`; a host such as the desktop app renders the nudge from `TLo` and answers through `ALo`,
 * which writes user `permissions.defaultMode = "auto"` on accept and `hasSeenAutoDefaultNudge` either way. This app is
 * the same kind of host for local CLIs, so it reads and writes exactly those keys. Project and local layers depend on
 * the draft's folder, so the client checks those (`autoDefaultOfferFor`).
 */

export interface AutoDefaultOfferDependencies
{
	/** Holds the user settings.json. */
	claudeDir: string;
	/** Holds the CLI's `.claude.json`. */
	configDir: string;
	readManagedSettings: () => Promise<unknown>;
}

const NO_STORE =
{
	"Cache-Control": "private, max-age=0, must-revalidate",
};
const NOTICE_SEEN_KEY = "hasSeenAutoDefaultNotice";
const NUDGE_SEEN_KEY = "hasSeenAutoDefaultNudge";
const BAD_BODY = 'Expected { surface: "notice" } or { surface: "nudge", choice }';
const OFF: AutoDefaultOffer =
{
	noticeEligible: false,
	nudgeMode: null,
};

async function readPolicyDefaultMode(dependencies: AutoDefaultOfferDependencies): Promise<string | undefined>
{
	try
	{
		const parsed = ClaudeSettingsSchema.safeParse(await dependencies.readManagedSettings());
		return parsed.success ? parsed.data.permissions?.defaultMode : undefined;
	}
	catch
	{
		// No managed settings: no policy.
		return undefined;
	}
}

/** The user's `permissions.defaultMode`, `undefined` when unset, or null when settings.json can't be read. */
async function readUserDefaultMode(claudeDir: string): Promise<string | undefined | null>
{
	const loaded = await loadSettings(settingsPathIn(claudeDir)).catch(() => null);
	if (loaded === null || loaded.kind === "invalid") return null;
	return loaded.kind === "loaded" ? loaded.settings.permissions?.defaultMode : undefined;
}

/** The CLI's `tengu_maple_pier` gate, read from its cached feature values with the CLI's default of true. */
function maplePierOn(config: Record<string, unknown>): boolean
{
	const features = config["cachedGrowthBookFeatures"];
	return !isRecord(features) || features["tengu_maple_pier"] !== false;
}

/** Fails closed: a file that can't be read never nags. */
async function readAutoDefaultOffer(dependencies: AutoDefaultOfferDependencies): Promise<AutoDefaultOffer>
{
	const [config, userMode, policyMode] = await Promise.all([
		readCliConfig(dependencies.configDir),
		readUserDefaultMode(dependencies.claudeDir),
		readPolicyDefaultMode(dependencies),
	]);
	if (config === null || userMode === null || config["hasCompletedOnboarding"] !== true) return OFF;
	if (policyMode !== undefined && policyMode !== "") return OFF;
	const userModeSet = userMode !== undefined && userMode !== "";
	return {
		noticeEligible: !userModeSet && config[NOTICE_SEEN_KEY] !== true,
		nudgeMode:
			userModeSet && userMode !== "auto" && config[NUDGE_SEEN_KEY] !== true && maplePierOn(config)
				? userMode
				: null,
	};
}

class SettingsConflict extends Error
{
}

/** CLI `ALo` for an answer: returns early once answered, writes Auto on accept, then marks the nudge seen. */
async function answerNudge(dependencies: AutoDefaultOfferDependencies, choice: "accept" | "decline"): Promise<void>
{
	if ((await readCliConfig(dependencies.configDir))?.[NUDGE_SEEN_KEY] === true) return;
	if (choice === "accept")
	{
		const path = settingsPathIn(dependencies.claudeDir);
		const loaded = await loadSettings(path);
		if (loaded.kind === "invalid") throw new SettingsConflict(loaded.message);
		if (loaded.kind === "missing" || loaded.settings.permissions?.defaultMode !== "auto")
		{
			const edited = editSettingsText(
				loaded.kind === "loaded" ? loaded.text : "{}\n",
				["permissions", "defaultMode"],
				"auto",
			);
			if (!edited.ok) throw new SettingsConflict(edited.message);
			await writeSettingsAtomically(path, dependencies.claudeDir, edited.text);
		}
	}
	await setCliConfigFlag(dependencies.configDir, NUDGE_SEEN_KEY);
}

async function recordAutoDefaultOffer(
	dependencies: AutoDefaultOfferDependencies,
	body: AutoDefaultOfferBody,
): Promise<void>
{
	if (body.surface === "notice") await setCliConfigFlag(dependencies.configDir, NOTICE_SEEN_KEY);
	else await answerNudge(dependencies, body.choice);
}

export async function handleAutoDefaultOfferGet(dependencies: AutoDefaultOfferDependencies): Promise<Response>
{
	return Response.json(
		await readAutoDefaultOffer(dependencies),
		{
			headers: NO_STORE,
		},
	);
}

/**
 * The notice posts when it is first painted (upstream burns its seen pref then, as the CLI's `xw` does); the nudge
 * posts its answer. Like the CLI host contract, a nudge closed by a reload before it was answered asks again.
 */
export async function handleAutoDefaultOfferPost(
	request: Request,
	dependencies: AutoDefaultOfferDependencies,
): Promise<Response>
{
	const rejection = rejectCrossSite(request);
	if (rejection) return rejection;
	const body = AutoDefaultOfferBodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success)
		return Response.json(
			{
				error: BAD_BODY,
			},
			{
				status: 400,
			},
		);
	try
	{
		await recordAutoDefaultOffer(dependencies, body.data);
		return await handleAutoDefaultOfferGet(dependencies);
	}
	catch (error)
	{
		return Response.json(
			{
				error: error instanceof Error ? error.message : String(error),
			},
			{
				status: error instanceof SettingsConflict ? 409 : 500,
			},
		);
	}
}

/** The real settings dir, CLI config dir and managed settings, for the route. */
export async function nodeAutoDefaultOfferDependencies(): Promise<AutoDefaultOfferDependencies>
{
	const [{defaultClaudeDir}, {nodeFastModeBlockDependencies}] = await Promise.all([
		import("./settings-file"),
		import("./composer-state-server"),
	]);
	return {
		claudeDir: defaultClaudeDir(),
		configDir: defaultCliConfigDir(),
		readManagedSettings: (await nodeFastModeBlockDependencies()).readManagedSettings,
	};
}
