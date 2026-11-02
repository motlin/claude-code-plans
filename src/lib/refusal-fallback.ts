import {formatModelName, SYNTHETIC_MODEL} from "./model-name";

/** The refusal categories upstream names (c06cf64bb `Bg`); anything else keeps only its raw string. */
const KNOWN_CATEGORIES = ["cyber", "bio", "frontier_llm", "reasoning_extraction"] as const;
export type RefusalCategory = (typeof KNOWN_CATEGORIES)[number];

/** A live safeguards refusal that moved the turn to a fallback model (upstream's `refusalFallback`). */
export interface RefusalFallback
{
	originalModel: string;
	fallbackModel: string;
	apiRefusalCategory: RefusalCategory | null;
	apiRefusalCategoryRaw: string | null;
	refusedUserMessageUuid: string | null;
	/** Consecutive refused turns; 2 or more is "escalated". */
	strike: number;
	/** The model the refused streak started on, which "Start a new session" goes back to. */
	streakOriginalModel: string;
	/** The fallback record's uuid, keying its dismissal. */
	uuid: string;
}

type RawRecord = Readonly<Record<string, unknown>>;

function str(value: unknown): string | null
{
	return typeof value === "string" && value !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function category(raw: string | null): RefusalCategory | null
{
	return KNOWN_CATEGORIES.find((known) => known === raw) ?? null;
}

/** Upstream `Lg`: a real human prompt, not meta, a compact summary or only tool results. */
function isHumanPrompt(record: RawRecord): boolean
{
	if (record["type"] !== "user" || record["isMeta"] === true || record["isCompactSummary"] === true) return false;
	const message = record["message"];
	if (!isRecord(message)) return false;
	const content: unknown = message["content"];
	if (typeof content === "string") return true;
	if (!Array.isArray(content) || content.length === 0) return false;
	return !content.every((block: unknown) => isRecord(block) && block["type"] === "tool_result");
}

/** An assistant reply's model, or null when none (or the synthetic sentinel) is recorded. */
function replyModel(record: RawRecord): string | null
{
	if (record["type"] !== "assistant") return null;
	const message = record["message"];
	if (!isRecord(message)) return null;
	const model = str(message["model"]);
	return model === SYNTHETIC_MODEL ? null : model;
}

function sameModel(a: string, b: string): boolean
{
	return a === b || formatModelName(a) === formatModelName(b);
}

/**
 * Port of upstream's refusal-fallback scan (c06cf64bb `Vg`/`Bg`/`Fg`) over a transcript window's raw
 * records. A retry fallback raises the strike (starting the streak's origin when the strike was 0); a
 * turn end (`system`/`turn_duration`, local's stand-in for the SDK `result`) resets it unless that
 * turn was refused; a human prompt clears the turn's refused flag. The returned entry is the last
 * fallback recorded at or after `liveSinceIndex` (session-absolute, like `startIndex`), so one found
 * while loading history never shows. A later human prompt dismisses it, and a later reply on another
 * model clears it (local's stand-in for upstream's live model change). Sidechain records and those in
 * `hidden` (abandoned branches) are skipped.
 */
export function activeRefusalFallback(
	records: readonly RawRecord[],
	startIndex: number,
	liveSinceIndex: number,
	hidden: ReadonlySet<string> = new Set(),
): RefusalFallback | null
{
	let strike = 0;
	let turnRefused = false;
	let origin: string | null = null;
	let active: RefusalFallback | null = null;
	for (const [offset, record] of records.entries())
	{
		if (record["isSidechain"] === true) continue;
		const uuid = str(record["uuid"]);
		if (uuid !== null && hidden.has(uuid)) continue;
		if (record["type"] === "system" && record["subtype"] === "model_refusal_fallback")
		{
			const originalModel = str(record["originalModel"]);
			const fallbackModel = str(record["fallbackModel"]);
			if (record["direction"] !== "retry" || originalModel === null || fallbackModel === null) continue;
			if (strike === 0 || origin === null) origin = originalModel;
			strike += 1;
			turnRefused = true;
			const raw = typeof record["apiRefusalCategory"] === "string" ? record["apiRefusalCategory"] : null;
			const index = startIndex + offset;
			active =
				index < liveSinceIndex
					? null
					:
						{
							originalModel,
							fallbackModel,
							apiRefusalCategory: category(raw),
							apiRefusalCategoryRaw: raw,
							refusedUserMessageUuid: str(record["refusedUserMessageUuid"]),
							strike,
							streakOriginalModel: origin,
							uuid: uuid ?? `record-${index}`,
						};
			continue;
		}
		if (record["type"] === "system" && record["subtype"] === "turn_duration")
		{
			if (!turnRefused)
			{
				strike = 0;
				origin = null;
			}
			turnRefused = false;
			continue;
		}
		if (isHumanPrompt(record))
		{
			turnRefused = false;
			active = null;
			continue;
		}
		const model = replyModel(record);
		if (active !== null && model !== null && !sameModel(model, active.fallbackModel)) active = null;
	}
	return active;
}
