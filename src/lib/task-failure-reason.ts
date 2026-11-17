import type {BackgroundTaskStatus} from "./background-tasks";

// eslint-disable-next-line no-control-regex -- matching ANSI escapes is the point
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;

/** Upstream's `wo` for a reason: ANSI and control characters stripped, blank as undefined. */
function sanitize(text: string | undefined): string | undefined
{
	if (text === undefined) return undefined;
	const clean = text.replace(ANSI_ESCAPE, "").replace(CONTROL, "").trim();
	return clean === "" ? undefined : clean;
}

/**
 * Upstream's `NO`: why a failed background task failed, read from its summary after the quoted
 * description (`Background command "x" failed with exit code 1` gives "exit code 1"). A long
 * description that the summary truncated matches on its last 50 characters instead.
 */
export function taskFailureReason({
	status,
	summary,
	description,
}: {
	status: BackgroundTaskStatus;
	summary: string | undefined;
	description: string | undefined;
}): string | undefined
{
	if (
		status !== "failed" ||
		summary === undefined ||
		summary === "" ||
		description === undefined ||
		description === ""
	)
	{
		return undefined;
	}
	let key = `"${description}" `;
	let at = summary.indexOf(key);
	if (at === -1 && description.length > 900)
	{
		key = `${description.slice(-50)}" `;
		at = summary.lastIndexOf(key);
	}
	if (at === -1) return undefined;
	const reason = (
		summary
			.slice(at + key.length)
			.replace(/^failed(?:: | with |$)/, "")
			.split("\n", 1)[0] ?? ""
	)
		.replace(/\.$/, "")
		.trim();
	return sanitize(reason);
}
