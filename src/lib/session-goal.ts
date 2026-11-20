import {z} from "zod";

import {asRecord} from "./narrow";
import {formatCount} from "./pluralize";

/**
 * The session's active `/goal`, the local stand-in for upstream's session-model `goal` (c5da7eb42 `OD`). Upstream
 * reads it from the sessions API's `external_metadata.goal`; locally it is folded from the CLI's `goal_status`
 * attachment rows the way the CLI restores it (`C1n`), then shaped like `OD`'s output.
 */
export interface SessionGoal
{
	/** Whitespace collapsed, control and format characters dropped, capped at 500 UTF-16 units plus `…`. */
	condition: string;
	/** Evaluator checks since the goal was set. */
	iterations: number;
	/** When the goal was set, in epoch ms; 0 when unknown. A new goal has a new `setAt`. */
	setAt: number;
	/** The newest check's reason, first line only, capped like `condition`. */
	lastReason?: string;
	/** The raw condition for a `/goal` prefill: whitespace runs as one space, capped at 4,000 units. */
	editText?: string;
}

/** The parts of a `goal_status` row the fold reads; the server keeps only these, for the whole file. */
export const GoalStatusRowSchema = z.object(
	{
		timestamp: z.string().optional(),
		attachment: z.object(
			{
				met: z.boolean(),
				condition: z.string(),
				sentinel: z.boolean().optional(),
				failed: z.boolean().optional(),
				reason: z.string().optional(),
			},
		),
	},
);

export type GoalStatusRow = z.infer<typeof GoalStatusRowSchema>;

/** Upstream's display cap (`dT`). */
const DISPLAY_CAP = 500;
/** Upstream's prefill cap (`ED`), the CLI's condition limit. */
const EDIT_CAP = 4000;

/** Cuts `text` to `cap` UTF-16 units, one fewer when the cut would split a surrogate pair. */
function cutUnits(text: string, cap: number): string
{
	if (text.length <= cap) return text;
	const highSurrogate = (text.charCodeAt(cap - 1) & 0xfc00) === 0xd800;
	return text.slice(0, highSurrogate ? cap - 1 : cap);
}

/** Upstream `dT`: one line of display text, capped with an ellipsis; undefined when nothing is left. */
function displayText(text: string): string | undefined
{
	const clean = text
		.replace(/\s+/g, " ")
		.replace(/[\p{Cc}\p{Cf}]/gu, "")
		.trim();
	if (clean === "") return undefined;
	return clean.length <= DISPLAY_CAP ? clean : `${cutUnits(clean, DISPLAY_CAP)}…`;
}

/** Upstream `Ty`: the text up to its first line break. */
function firstLine(text: string): string
{
	const newline = text.indexOf("\n");
	return newline === -1 ? text : text.slice(0, newline);
}

interface GoalState
{
	condition: string;
	iterations: number;
	setAt: number;
	lastReason: string | undefined;
}

/**
 * The goal the rows leave active (CLI `C1n` plus upstream `OD`): a met or failed row ends it, a not-met row with a
 * new condition starts one, a not-met sentinel for the same condition (a compaction carry) changes nothing, and a
 * not-met check counts a turn and records its reason.
 */
export function activeGoal(rows: readonly GoalStatusRow[]): SessionGoal | null
{
	let goal = null as GoalState | null;
	for (const {timestamp, attachment} of rows)
	{
		if (attachment.met || attachment.failed === true)
		{
			goal = null;
			continue;
		}
		if (goal?.condition !== attachment.condition)
		{
			const setAt = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
			goal =
			{
				condition: attachment.condition,
				iterations: 0,
				setAt: Number.isFinite(setAt) && setAt > 0 ? setAt : 0,
				lastReason: undefined,
			};
		}
		if (attachment.sentinel === true) continue;
		goal.iterations += 1;
		goal.lastReason = displayText(firstLine((attachment.reason ?? "").trim()));
	}
	if (goal === null) return null;
	const condition = displayText(goal.condition);
	if (condition === undefined) return null;
	const editText = cutUnits(
		goal.condition
			.slice(0, EDIT_CAP * 4)
			.replace(/\s+/g, " ")
			.replace(/[\p{Cc}\p{Cf}]/gu, "")
			.trim(),
		EDIT_CAP,
	);
	return {
		condition,
		iterations: goal.iterations,
		setAt: goal.setAt,
		...(goal.lastReason !== undefined &&
		{
			lastReason: goal.lastReason,
		}),
		...(editText !== "" &&
		{
			editText,
		}),
	};
}

/** A JSONL record's `goal_status` row, or null for any other record. */
export function goalStatusRow(record: Record<string, unknown> | undefined): GoalStatusRow | null
{
	if (record?.["type"] !== "attachment") return null;
	const attachment = asRecord(record["attachment"]);
	if (attachment?.["type"] !== "goal_status") return null;
	const {met, condition, sentinel, failed, reason} = attachment;
	if (typeof met !== "boolean" || typeof condition !== "string") return null;
	const timestamp = record["timestamp"];
	return {
		...(typeof timestamp === "string" &&
		{
			timestamp,
		}),
		attachment:
		{
			met,
			condition,
			...(typeof sentinel === "boolean" &&
			{
				sentinel,
			}),
			...(typeof failed === "boolean" &&
			{
				failed,
			}),
			...(typeof reason === "string" &&
			{
				reason,
			}),
		},
	};
}

/** `existing` plus the goal rows among `records`, in file order. */
export function appendGoalStatusRows(
	existing: readonly GoalStatusRow[],
	records: readonly (Record<string, unknown> | undefined)[],
): GoalStatusRow[]
{
	const rows = [...existing];
	for (const record of records)
	{
		const row = goalStatusRow(record);
		if (row !== null) rows.push(row);
	}
	return rows;
}

/** Upstream `BI`: the turn count, or Not checked yet before the first check. */
export function goalTurnsSummary(iterations: number): string
{
	return iterations === 0 ? "Not checked yet" : formatCount(iterations, "turn");
}
