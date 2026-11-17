/**
 * The CLI's "Session paused" refusal-fallback dialog, derived from CLI 2.1.319 `dMe` (a warning frame titled
 * "Session paused", the `Rwt` body, an optional `inactive` guidance block, then a `Ze` select with Switch first)
 * and laid out like the real captures in .llm/upstream-sync/dumps/permission-dialog-capture-spike-screens-2026-11-06.txt
 * (rule line, title, body, rows, "Esc to cancel").
 * TODO: replace these with a real pane capture the first time a refusal dialog appears.
 */

const RULE = "─".repeat(100);

const HEADER = ["⏺ Looking into the exploit chain now.", "", RULE, " Session paused", ""];

/** The dialog with a category and both model names, focus on row 1. */
export const REFUSAL_DIALOG = [
	...HEADER,
	"  Opus 4.7's safeguards flagged this message. This sometimes happens with safe, normal",
	"  conversations. Details: [cyber]",
	"",
	" ❯ 1. Switch to Sonnet 4.6",
	"   2. Edit prompt and retry with Opus 4.7",
	"",
	" Esc to cancel",
].join("\n");

/** The CLI's labels when it knows neither model's display name (`Twt`), no category. */
export const REFUSAL_DIALOG_BARE_LABELS = [
	...HEADER,
	"  This model's safeguards flagged this message.",
	"",
	" ❯ 1. Switch to the fallback model",
	"   2. Edit prompt and retry",
	"",
	" Esc to cancel",
].join("\n");

/** A guidance block in `inactive` colour after one blank line, focus moved to row 2. */
export const REFUSAL_DIALOG_GUIDANCE = [
	...HEADER,
	"  Opus 4.7's safeguards flagged this message. Details: `[bio]`",
	"",
	"  Try rephrasing the request without",
	"  the lab protocol details.",
	"",
	"   1. Switch to Sonnet 4.6",
	" ❯ 2. Edit prompt and retry with Opus 4.7",
	"",
	" Esc to cancel",
].join("\n");

/** The sibling usage-credits "Session paused" dialog (`hje`): same title, other choices. */
export const USAGE_CREDITS_DIALOG = [
	...HEADER,
	"  You've hit your usage limit.",
	"",
	" ❯ 1. Continue on usage credits",
	"   2. Switch models",
	"",
	" Esc to cancel",
].join("\n");

/** A "Session paused" line left above the CLI's prompt box, with no rows under it. */
export const STALE_TITLE = [...HEADER, "  Opus 4.7's safeguards flagged this message.", "", RULE, "❯ ", RULE].join(
	"\n",
);

/** The prompt box after "Edit prompt and retry": the refused prompt is back in the CLI's input. */
export function promptBox(input: string): string
{
	return ["⏺ Looking into the exploit chain now.", "", RULE, `❯ ${input}`, RULE, "  ? for shortcuts"].join("\n");
}
