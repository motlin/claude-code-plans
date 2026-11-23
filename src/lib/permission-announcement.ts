/**
 * Upstream's permission card arrival announcement (claude.ai/code cc32965c2 `Jy` → `qy` lead + `Yy` parts): the
 * text a screen reader hears when a permission card arrives, read from one polite status region.
 */

import type {PendingPermission, PermissionFold} from "./permission-card";
import {LINE_ENDINGS_MAY_CHANGE_NOTE, lineEndingsMayChange} from "./permission-file-change";
import type {PermissionRow} from "./permission-rows";

/** Upstream's `Cb`: the most code points a capped part reads before it is cut. */
const SPOKEN_MAX = 150;
/** Upstream's `Iy`: the most rows read one by one. */
const ROWS_READ = 10;

/** Upstream's `zy` (s6kKhf): read instead of rows that can't be read out. */
export const ROWS_UNVOICED = "Some of what was sent can’t be read out here. It is listed on the card.";

/** Upstream's token warning (eFJU0S) with its `<link>` tags stripped. */
export const TOKEN_WARNING_SPOKEN =
	"Dynamic workflows run many subagents in parallel and can use a lot of your usage limit. Stop them any time from the background tasks pane.";

function collapse(text: string): string
{
	return text.replace(/\s+/gu, " ").trim();
}

/** Upstream's `fo` (ca8b34310 `wb`): whitespace collapsed, and past 150 code points "{head}, truncated". */
export function spokenCap(text: string, max = SPOKEN_MAX): string
{
	const collapsed = collapse(text);
	const chars = Array.from(collapsed);
	return chars.length <= max ? collapsed : `${chars.slice(0, max).join("")}, truncated`;
}

export type PermissionAnnouncementInput = Pick<PendingPermission, "title" | "detail"> &
	Partial<
		Pick<
			PendingPermission,
			| "detailNote"
			| "description"
			| "tokenWarning"
			| "rows"
			| "rowsTrail"
			| "rowsUnvoiced"
			| "folds"
			| "fileChange"
			| "toolName"
			| "toolInput"
		>
	>;

/** Upstream's `Ny`: a heading in full, else the capped action, naming its origin when the action was cut. */
function spokenAction(title: PendingPermission["title"]): string
{
	if ("heading" in title) return collapse(title.heading);
	const action = collapse(title.action);
	const capped = spokenCap(action);
	return title.origin === undefined || capped === action ? capped : `${capped}, from ${spokenCap(title.origin)}`;
}

/** Upstream's `jy` label join: "{label}: {text}", a multi-line text on indented lines under the label. */
function labelled(label: string, text: string): string
{
	return text.includes("\n") ? `${label}:\n  ${text.replace(/\n/g, "\n  ")}` : `${label}: ${text}`;
}

/** Upstream's `My`: the lines, an indented line kept with the line above it. */
function spokenLines(text: string): string[]
{
	const lines: string[] = [];
	for (const line of text.split("\n"))
	{
		if (line.startsWith("  ") && lines.length > 0) lines[lines.length - 1] += `\n${line}`;
		else lines.push(line);
	}
	return lines;
}

/** Upstream's `jy`: each line read as "{i} of {n}, {line}". */
function spokenRows(text: string): string
{
	const lines = spokenLines(text);
	return lines.map((line, index) => `${index + 1} of ${lines.length}, ${spokenCap(line)}`).join(". ");
}

/**
 * Upstream's `qy`: the lead sentence, reading the detail only when it adds to the meta (`ux`). An open fold adds its
 * label and text, a closed one its label; folds without a voiced detail are read as rows, after the meta when there
 * is one (`after`).
 */
function leadSentence(p: PermissionAnnouncementInput):
{
	text: string;
	after: string | undefined;
}
{
	const action = spokenAction(p.title);
	const rawMeta = "heading" in p.title ? null : p.title.meta;
	const meta = rawMeta === null || rawMeta === "" ? null : spokenCap(rawMeta);
	const folds = (p.folds ?? []).map((fold: PermissionFold) =>
		fold.open === true ? labelled(fold.label, fold.text) : fold.label,
	);
	const detailVoiced = p.detail !== null && p.detail !== "" && (p.detail !== rawMeta || (p.detailNote ?? "") !== "");
	const voiced =
		detailVoiced && p.detail !== null
			? [p.detail, ...folds].join("\n")
			: folds.length > 0
				? folds.join("\n")
				: null;
	const asRows = voiced !== null && (p.detail === null || p.detail === "");
	const detail = voiced === null ? null : asRows ? spokenRows(voiced) : spokenCap(voiced);
	const after = detail !== null && meta !== null && !detailVoiced ? detail : undefined;
	let text: string;
	if (detail !== null && meta !== null && after === undefined)
		text = `Permission requested: ${action}. ${detail}, ${meta}`;
	else if (meta !== null) text = `Permission requested: ${action}, ${meta}`;
	else if (detail === null)
	{
		text = `Permission requested: ${action}`;
	}
	else
	{
		text = `Permission requested: ${action}. ${detail}`;
	}
	return {
		text,
		after,
	};
}

/** Upstream's `By` ? `zy` : `Ly`: the rows read "{i} of {n}, {label}: {value}", or the unvoiced sentence. */
function rowsVoice(rows: readonly PermissionRow[], unvoiced: boolean): string | undefined
{
	if (rows.length === 0) return undefined;
	if (unvoiced || rows.some((row) => "rows" in row)) return ROWS_UNVOICED;
	const leaves = rows.flatMap((row) => ("rows" in row ? [] : [`${spokenCap(row.label)}: ${spokenCap(row.value)}`]));
	const read = leaves.slice(0, ROWS_READ).map((row, index) => `${index + 1} of ${leaves.length}, ${row}`);
	const more = leaves.length - ROWS_READ;
	if (more > 0) read.push(`and ${more} more ${more === 1 ? "row" : "rows"}`);
	return read.join(". ");
}

/** Upstream's `mS` closing part: a previewed change without its file may change line endings. */
function fileChangeVoice(p: PermissionAnnouncementInput): string | undefined
{
	return p.fileChange === "preview" &&
		p.toolName !== undefined &&
		p.toolInput !== undefined &&
		lineEndingsMayChange(p.toolName, p.toolInput)
		? LINE_ENDINGS_MAY_CHANGE_NOTE
		: undefined;
}

/** Upstream's `Jy`: the lead sentence, then each non-blank part as "{announcement}. {extra}" in upstream's order. */
export function permissionAnnouncement(p: PermissionAnnouncementInput): string
{
	const lead = leadSentence(p);
	const rows = rowsVoice(p.rows ?? [], p.rowsUnvoiced === true);
	const trail = p.rowsTrail === true;
	const parts:
	{
		text: string | null | undefined;
		capped: boolean;
	}[] = [
		{
			text: lead.after,
			capped: false,
		},
		{
			text: p.detailNote,
			capped: false,
		},
		{
			text: p.description,
			capped: true,
		},
		{
			text: fileChangeVoice(p),
			capped: false,
		},
		{
			text: trail ? undefined : rows,
			capped: false,
		},
		{
			text: p.tokenWarning === true ? TOKEN_WARNING_SPOKEN : undefined,
			capped: false,
		},
		{
			text: trail ? rows : undefined,
			capped: false,
		},
	];
	return parts.reduce((announcement, {text, capped}) =>
	{
		if (text === null || text === undefined || text.trim() === "") return announcement;
		return `${announcement}. ${capped ? spokenCap(text) : collapse(text)}`;
	}, lead.text);
}
