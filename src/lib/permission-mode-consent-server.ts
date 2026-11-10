import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {
	type PermissionModeConsent,
	PermissionModeConsentBodySchema,
	type PermissionModeConsentBody,
} from "./api/permission-mode-consent";
import {defaultCliConfigDir, readCliConfigFlag, setCliConfigFlag} from "./cli-global-config";
import type * as schema from "./db/schema";
import {addPermissionModeAck, getPermissionModeAcks} from "./db/permission-mode-acks";
import {recordAck} from "./permission-mode-consent";
import {ClaudeSettingsSchema} from "./runtime-schemas";
import {rejectCrossSite} from "./same-origin-guard";
import {editSettingsText, loadSettings, settingsPathIn, writeSettingsAtomically} from "./settings-file";

/*
 * The permission mode guard's store. Auto consent and the Bypass opt-in live in the CLI's own files, read and written
 * exactly as the CLI does, so neither the CLI nor the browser asks again for what the other already asked:
 * - Auto: the CLI skips its auto-mode entry warning when `skipAutoPermissionPrompt` is set in user or policy settings,
 *   or when `.claude.json` has `hasSeenAutoModeEntryWarning`, which it writes once it has shown the warning.
 * - Bypass: the CLI's disclaimer writes `skipDangerousModePermissionPrompt: true` to user settings on accept.
 * Upstream asks for Bypass once per workspace, which the CLI has no file for, so those acks live in index.db.
 */

export interface ConsentStoreDependencies {
	db: BetterSQLite3Database<typeof schema>;
	/** Holds the user settings.json. */
	claudeDir: string;
	/** Holds the CLI's `.claude.json`. */
	configDir: string;
	readManagedSettings: () => Promise<unknown>;
}

const NO_STORE = {"Cache-Control": "private, max-age=0, must-revalidate"};
const AUTO_CONSENT_KEY = "hasSeenAutoModeEntryWarning";

async function readManaged(dependencies: ConsentStoreDependencies) {
	try {
		const parsed = ClaudeSettingsSchema.safeParse(await dependencies.readManagedSettings());
		return parsed.success ? parsed.data : null;
	} catch {
		// No managed settings: no policy.
		return null;
	}
}

async function readAutoModeIsDefault(dependencies: ConsentStoreDependencies): Promise<boolean> {
	const loaded = await loadSettings(settingsPathIn(dependencies.claudeDir)).catch(() => null);
	const user = loaded?.kind === "loaded" ? loaded.settings : null;
	const policy = await readManaged(dependencies);
	return (
		user?.permissions?.defaultMode === "auto" ||
		user?.skipAutoPermissionPrompt === true ||
		policy?.skipAutoPermissionPrompt === true
	);
}

async function readPermissionModeConsent(dependencies: ConsentStoreDependencies): Promise<PermissionModeConsent> {
	const [autoModeIsDefault, autoConsented] = await Promise.all([
		readAutoModeIsDefault(dependencies),
		readCliConfigFlag(dependencies.configDir, AUTO_CONSENT_KEY),
	]);
	return {autoModeIsDefault, autoConsented, acks: getPermissionModeAcks(dependencies.db)};
}

/** The CLI's Bypass disclaimer accept: user settings `skipDangerousModePermissionPrompt: true`. */
async function acceptBypassInSettings(claudeDir: string): Promise<void> {
	const path = settingsPathIn(claudeDir);
	const loaded = await loadSettings(path);
	if (loaded.kind === "invalid") return;
	if (loaded.kind === "loaded" && loaded.settings.skipDangerousModePermissionPrompt === true) return;
	const edited = editSettingsText(
		loaded.kind === "loaded" ? loaded.text : "{}\n",
		["skipDangerousModePermissionPrompt"],
		true,
	);
	if (edited.ok) await writeSettingsAtomically(path, claudeDir, edited.text);
}

async function recordPermissionModeConsent(
	dependencies: ConsentStoreDependencies,
	{mode, workspace}: PermissionModeConsentBody,
): Promise<PermissionModeConsent> {
	if (mode === "auto") {
		await setCliConfigFlag(dependencies.configDir, AUTO_CONSENT_KEY);
	} else {
		const acks = getPermissionModeAcks(dependencies.db);
		const next = recordAck({mode, workspace, acks, autoConsented: false}).acks;
		for (const key of next.slice(acks.length)) addPermissionModeAck(dependencies.db, key);
		await acceptBypassInSettings(dependencies.claudeDir);
	}
	return readPermissionModeConsent(dependencies);
}

export async function handlePermissionModeConsentGet(dependencies: ConsentStoreDependencies): Promise<Response> {
	return Response.json(await readPermissionModeConsent(dependencies), {headers: NO_STORE});
}

export async function handlePermissionModeConsentPost(
	request: Request,
	dependencies: ConsentStoreDependencies,
): Promise<Response> {
	const rejection = rejectCrossSite(request);
	if (rejection) return rejection;
	const body = PermissionModeConsentBodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return Response.json({error: "Expected { mode, workspace }"}, {status: 400});
	try {
		return Response.json(await recordPermissionModeConsent(dependencies, body.data), {headers: NO_STORE});
	} catch (error) {
		return Response.json({error: error instanceof Error ? error.message : String(error)}, {status: 500});
	}
}

/** The real index.db, settings dir, CLI config dir and managed settings, for the route. */
export async function nodeConsentStoreDependencies(): Promise<ConsentStoreDependencies> {
	const [{getDb}, {defaultClaudeDir}, {nodeFastModeBlockDependencies}] = await Promise.all([
		import("./db"),
		import("./settings-file"),
		import("./composer-state-server"),
	]);
	return {
		db: getDb().index,
		claudeDir: defaultClaudeDir(),
		configDir: defaultCliConfigDir(),
		readManagedSettings: (await nodeFastModeBlockDependencies()).readManagedSettings,
	};
}
