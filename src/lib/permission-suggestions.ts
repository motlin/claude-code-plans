import {z} from "zod";
import {assertNever} from "./assert-never";
import type {PermissionUpdate} from "./hook-events";
import type {PermissionDialogKind} from "./outside-read-prompt";

/**
 * The persistent allow option upstream's permission card offers beside
 * "Allow once": `always` saves a rule to a settings file, `perChat` lasts for
 * the session.
 */
export const PersistentAllowKindSchema = z.enum(["always", "perChat"]);
export type PersistentAllowKind = z.infer<typeof PersistentAllowKindSchema>;

/**
 * The persistent option's label. Upstream's web card (cc32965c2 `Ln`) always says "Always allow": its
 * "Allow for this session" label and destination scope copy (`Jb`, formerly `Sb`) are desktop-only (ipc
 * transport).
 */
export const PERSISTENT_ALLOW_LABEL = "Always allow";

/**
 * Upstream's default scope tooltip (`Zr`, `AfvuXL`) on the persistent option. The web card drops it whenever it
 * lists the saves (`Bn`), so it shows only when the saves are unknown.
 */
export const PERSISTENT_ALLOW_SCOPE = "Don’t ask again for this tool";

/** One thing "Always allow" adds, as upstream's saves block lists it. */
export type PersistentAllowSave = {kind: "rule"; toolName: string; ruleContent?: string} | {kind: "acceptEditsMode"};

export const PersistentAllowSaveSchema: z.ZodType<PersistentAllowSave> = z.union([
	z.strictObject({kind: z.literal("rule"), toolName: z.string(), ruleContent: z.string().exactOptional()}),
	z.strictObject({kind: z.literal("acceptEditsMode")}),
]);

function savesOf(update: PermissionUpdate): PersistentAllowSave[] {
	switch (update.type) {
		case "addRules":
			return update.rules.map(({toolName, ruleContent}) =>
				ruleContent === undefined ? {kind: "rule", toolName} : {kind: "rule", toolName, ruleContent},
			);
		case "setMode":
			return [{kind: "acceptEditsMode"}];
		case "addDirectories":
		case "replaceRules":
		case "removeRules":
		case "removeDirectories":
			return [];
		default:
			return assertNever(update);
	}
}

/**
 * What "Always allow" adds, from the hook's `permission_suggestions`, as upstream's web card lists it
 * (cc32965c2 `Zb`/`$b`/`ex`, now `wx`/`Ex`/`Dx`): every rule of an `addRules` whatever its behavior, the
 * accept-edits mode for any `setMode`, and nothing for directories, replacements or removals.
 */
export function persistentAllowSaves(suggestions: readonly PermissionUpdate[]): PersistentAllowSave[] {
	return suggestions.flatMap(savesOf);
}

export type PermissionDialogDecision = "allow" | "deny" | "always";

/** Which kind of persistent option an update saved to each destination is: settings files persist, the rest end with the session. */
export const PERSISTENT_ALLOW_KIND_BY_DESTINATION = {
	userSettings: "always",
	projectSettings: "always",
	localSettings: "always",
	session: "perChat",
	cliArg: "perChat",
} as const satisfies Record<PermissionUpdate["destination"], PersistentAllowKind>;

/**
 * The dialog builds its persistent option only from allow rules, directories,
 * and the accept-edits mode; it never offers removals, replacements, or deny
 * rules.
 */
function offersPersistentOption(update: PermissionUpdate): boolean {
	switch (update.type) {
		case "addRules":
			return update.behavior === "allow";
		case "addDirectories":
		case "setMode":
			return true;
		case "replaceRules":
		case "removeRules":
		case "removeDirectories":
			return false;
		default:
			return assertNever(update);
	}
}

/**
 * Whether the CLI's permission dialog offers a persistent "Yes, and don't ask
 * again" option, and of which kind, from the PermissionRequest hook's
 * `permission_suggestions`.
 */
export function persistentAllowKind(suggestions: readonly PermissionUpdate[] | undefined): PersistentAllowKind | null {
	const offered = suggestions?.find(offersPersistentOption);
	return offered === undefined ? null : PERSISTENT_ALLOW_KIND_BY_DESTINATION[offered.destination];
}

/**
 * The key that picks `decision` in the CLI's permission dialog: "1" is "Yes"
 * except in auto mode's first outside-read prompt, where 1 is the lasting
 * "keep allowing" row and 4 the one-time "Yes, but ask again next time"; that
 * dialog has no session-only grant. Esc declines. The persistent option is "2"
 * only when the dialog has one; without it "2" is "No", so there is no key and
 * the caller refuses.
 */
export function permissionDialogKey(
	decision: PermissionDialogDecision,
	persistent: PersistentAllowKind | null,
	dialog: PermissionDialogKind = "generic",
): string | null {
	if (dialog === "outsideReadFirstPrompt") {
		if (decision === "always") return null;
		return decision === "allow" ? "4" : "esc";
	}
	switch (decision) {
		case "allow":
			return "1";
		case "deny":
			return "esc";
		case "always":
			return persistent === null ? null : "2";
		default:
			return assertNever(decision);
	}
}
