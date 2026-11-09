import type {LaunchPermissionMode} from "./launch-options";

/*
 * Upstream's permission mode consent guard (ca8b34310 `Xm`/`qm`/`Lm`/`Hm`) and its dialog copy (cbf7370a7).
 * Picking Bypass asks once per workspace; picking Auto asks once, unless auto is already the default.
 */

/** The modes the guard can hold; every other pick applies at once. */
export type ConsentMode = "auto" | "bypassPermissions";

export const PERMISSION_SECURITY_GUIDE_URL = "https://code.claude.com/docs/en/security";

export interface ConsentState {
	/** The workspace's bypass acks, `${workspace}:bypassPermissions`. */
	acks: readonly string[];
	/** The one Auto consent. */
	autoConsented: boolean;
}

/** Upstream `Lm`: Bypass always asks; Auto asks unless it's already the default. */
export function needsConsent(mode: LaunchPermissionMode, {autoIsDefault}: {autoIsDefault: boolean}): boolean {
	return mode === "bypassPermissions" || (mode === "auto" && !autoIsDefault);
}

/** Upstream `Hm`: a local folder's absolute path, with a trailing worktree stripped so it shares its repo's ack. */
export function consentWorkspaceKey(cwd: string | undefined): string {
	return (cwd ?? "").replace(/\/\.claude\/worktrees\/[^/]+$/u, "");
}

function bypassAckKey(workspace: string): string {
	return `${workspace}:bypassPermissions`;
}

/** Upstream `qm`'s `isAcked`: no workspace can ever hold a Bypass ack. */
export function isAcked(mode: ConsentMode, state: ConsentState & {workspace: string}): boolean {
	if (mode === "auto") return state.autoConsented;
	return state.workspace !== "" && state.acks.includes(bypassAckKey(state.workspace));
}

/** Upstream `confirm()` (without `asksEveryTime`): what a confirm stores. */
export function recordAck({
	mode,
	workspace,
	acks,
	autoConsented,
}: ConsentState & {mode: ConsentMode; workspace: string}): {acks: string[]; autoConsented: boolean} {
	if (mode === "auto") return {acks: [...acks], autoConsented: true};
	const key = bypassAckKey(workspace);
	return {acks: workspace === "" || acks.includes(key) ? [...acks] : [...acks, key], autoConsented};
}

export interface ConsentCopy {
	title: string;
	description: string;
	confirmLabel: string;
	/** The footnote's text before its "security guide" link; " for details." follows the link. */
	footnoteLead: string;
}

/** Upstream cbf7370a7's strings (hjpZ5o/3E39Hl, cq1Jnu/ZKHkSX, PHx7oH/JcgKJo, KX6RZT/faOd+4/Def34y). */
export function consentCopy({
	mode,
	workspace,
	asksEveryTime,
}: {
	mode: ConsentMode;
	workspace: string;
	asksEveryTime: boolean;
}): ConsentCopy {
	const bypass = mode === "bypassPermissions";
	const footnoteLead =
		asksEveryTime || (bypass && workspace === "")
			? "Read our "
			: bypass
				? "You won’t be asked again for this workspace. Read our "
				: "You won’t be asked again. Read our ";
	return bypass
		? {
				title: "Bypass all permissions?",
				description:
					"Claude will read, edit, and execute files without asking — including potentially destructive commands. Only use this in isolated or disposable environments.",
				confirmLabel: "Bypass permissions",
				footnoteLead,
			}
		: {
				title: "Enable auto mode?",
				description:
					"Claude will decide which actions are safe to run without asking. Longer tasks run uninterrupted, with extra safeguards against prompt injection.",
				confirmLabel: "Enable auto mode",
				footnoteLead,
			};
}
