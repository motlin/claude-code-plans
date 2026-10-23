import {z} from "zod";
import {assertNever} from "./assert-never";
import type {PermissionUpdate} from "./hook-events";

/**
 * The persistent allow option upstream's permission card offers beside
 * "Allow once": `always` saves a rule to a settings file, `perChat` lasts for
 * the session.
 */
export const PersistentAllowKindSchema = z.enum(["always", "perChat"]);
export type PersistentAllowKind = z.infer<typeof PersistentAllowKindSchema>;

export const PERSISTENT_ALLOW_LABELS = {
	always: "Always allow",
	perChat: "Allow for this session",
} as const satisfies Record<PersistentAllowKind, string>;

/** Upstream's sr-only scope after the persistent label, saying how long the grant lasts. */
export const PERSISTENT_ALLOW_SCOPES = {
	always: "Don\u2019t ask again for this tool",
	perChat: "Applies to this session only",
} as const satisfies Record<PersistentAllowKind, string>;

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
 * The key that picks `decision` in the CLI's permission dialog: "1" is always
 * "Yes" and Esc declines. The persistent option is "2" only when the dialog
 * has one; without it "2" is "No", so there is no key and the caller refuses.
 */
export function permissionDialogKey(
	decision: PermissionDialogDecision,
	persistent: PersistentAllowKind | null,
): string | null {
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
