import {isRecord} from "./narrow";

/** The session's output style from its statusline snapshot (`output_style.name`), when it names one. */
export function sessionOutputStyle(statusline: unknown): string | undefined
{
	if (!isRecord(statusline)) return undefined;
	const style = statusline["output_style"];
	if (!isRecord(style)) return undefined;
	const name = style["name"];
	return typeof name === "string" && name.length > 0 ? name : undefined;
}
