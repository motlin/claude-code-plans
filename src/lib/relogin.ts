import type {ApiErrorCategory} from "./api-error-category";
import {localCommandOutput} from "../components/system-banner-text";
import {isCommandLine, isStdoutLine, type SessionLine} from "./transcript";

const LOGIN_SUCCESSFUL = "Login successful";
const LOGIN_COMMAND = "<command-name>/login</command-name>";

function userText(line: SessionLine | undefined): string | undefined
{
	if (line?.type !== "user") return undefined;
	const content = line.message?.content;
	return typeof content === "string" ? content : undefined;
}

/**
 * When `line` records a successful `/login` (the CLI's `local_command` output record, or its stdout user
 * record right after `/login`), its timestamp; else undefined.
 */
function successfulLoginTime(line: SessionLine, previous: SessionLine | undefined): string | undefined
{
	if (line.type === "system")
		return line.subtype === "local_command" &&
			line.commandRun?.command === "login" &&
			localCommandOutput(line.content) === LOGIN_SUCCESSFUL
			? line.timestamp
			: undefined;
	if (line.type !== "user" || !isStdoutLine(line) || previous === undefined || !isCommandLine(previous))
		return undefined;
	return (userText(previous) ?? "").includes(LOGIN_COMMAND) && localCommandOutput(userText(line)) === LOGIN_SUCCESSFUL
		? line.timestamp
		: undefined;
}

/**
 * The local analogue of upstream's relogin time (`Ek`): when the session's latest successful `/login`
 * finished, in epoch ms, or null when it has none.
 */
export function loginSucceededAt(lines: readonly SessionLine[]): number | null
{
	let latest: number | null = null;
	for (const [index, line] of lines.entries())
	{
		const timestamp = successfulLoginTime(line, lines[index - 1]);
		const at = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
		if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
	}
	return latest;
}

/** Upstream's `Ok`: an auth error strictly older than the relogin collapses to the "Signed in again" marker. */
export function collapsesToSignedInAgain(
	{
		category,
		timestamp,
	}:
	{
		category: ApiErrorCategory;
		timestamp: string | undefined;
	},
	reloginAt: number | null,
): boolean
{
	if (category !== "auth" || reloginAt === null || timestamp === undefined) return false;
	const errorAt = Date.parse(timestamp);
	return Number.isFinite(errorAt) && reloginAt > errorAt;
}
