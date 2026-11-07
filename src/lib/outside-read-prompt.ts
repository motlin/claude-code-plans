import {readFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import type {PendingPermissionRequest} from "./active-session-store";

/**
 * Auto mode's first Read/Grep/Glob outside the working directories opens a
 * four-row dialog (CLI 2.1.319 `UZt`) whose rows 1 and 2 make lasting changes:
 * row 1 writes the global `hasSeenAutoModeOutsideReadPrompt` flag and row 2
 * blocks outside reads in every project. Its PermissionRequest hook looks like
 * the default-mode outside-read dialog apart from `permission_mode: "auto"`.
 */
export type PermissionDialogKind = "generic" | "outsideReadFirstPrompt";

const OUTSIDE_READ_TOOLS: ReadonlySet<string> = new Set(["Read", "Grep", "Glob"]);

/** Everything the hook shows of the first-prompt dialog, before the global flag is checked. */
function looksLikeOutsideReadFirstPrompt(request: PendingPermissionRequest): boolean {
	if (request.permissionMode !== "auto" || !OUTSIDE_READ_TOOLS.has(request.toolName)) return false;
	if (request.suggestions.length !== 1) return false;
	const [suggestion] = request.suggestions;
	return (
		suggestion?.type === "addRules" &&
		suggestion.behavior === "allow" &&
		suggestion.destination === "session" &&
		suggestion.rules.length > 0 &&
		suggestion.rules.every(
			(rule) => rule.toolName === request.toolName && rule.ruleContent?.endsWith("/**") === true,
		)
	);
}

/** Whether the pending dialog is auto mode's first outside-read prompt rather than the ordinary one. */
export function isOutsideReadFirstPrompt(request: PendingPermissionRequest, hasSeenPrompt: boolean): boolean {
	return !hasSeenPrompt && looksLikeOutsideReadFirstPrompt(request);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `<configDir>/.claude.json` says the CLI already showed the prompt; false when it can't be read. */
export async function readHasSeenOutsideReadPrompt(configDir: string): Promise<boolean> {
	try {
		const raw: unknown = JSON.parse(await readFile(join(configDir, ".claude.json"), "utf-8"));
		return isRecord(raw) && raw["hasSeenAutoModeOutsideReadPrompt"] === true;
	} catch {
		return false;
	}
}

/**
 * Which dialog the session's pending PermissionRequest opened. The global flag
 * lives in the CLI's config dir (`CLAUDE_CONFIG_DIR`, else the home), and is
 * read only when the hook already looks like the first prompt.
 */
export async function outsideReadDialogKind(
	request: PendingPermissionRequest | undefined,
	claudeEnv: Readonly<Record<string, string>>,
	readHasSeen: (configDir: string) => Promise<boolean> = readHasSeenOutsideReadPrompt,
	home: string = homedir(),
): Promise<PermissionDialogKind> {
	if (request === undefined || !looksLikeOutsideReadFirstPrompt(request)) return "generic";
	const hasSeen = await readHasSeen(claudeEnv["CLAUDE_CONFIG_DIR"] ?? home);
	return isOutsideReadFirstPrompt(request, hasSeen) ? "outsideReadFirstPrompt" : "generic";
}
