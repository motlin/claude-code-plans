import {SYNTHETIC_MODEL} from "./model-name";
import {rewindTurns} from "./rewind-picker";
import {isPrompt} from "./transcript-chain";

/*
 * Upstream's hard-block card ("Message blocked" with Edit and retry), gated by GrowthBook
 * `__gb__4139533735` (cf6ae6197 `Vs()`): with it on, the session view publishes the hard-block host
 * (`Fc`) for the viewer's own session and c3fef5c6f `N_` draws a refusal row as the cds Banner `j_`
 * instead of the legacy "Message flagged" API-error card. The key was absent from GrowthBook for the
 * live account on 2026-11-05; locally it ships on (upstream-sync M6, 11-04 Q2 answer c). Switching it
 * off restores the legacy card.
 */
export const HARD_BLOCK_CARDS: boolean = true;

/** A refused assistant turn (upstream c91b1ad59 `Ui`'s answer, without the stop details local doesn't record). */
export interface HardBlock
{
	/** The refused assistant record's uuid, which keys its card. */
	uuid: string;
	model: string | null;
	/** The blocked prompt is still the last rewindable prompt, so Edit and retry can rewind to it. */
	hasMessage: boolean;
}

type RawRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordModel(record: RawRecord): string | null
{
	const message = record["message"];
	if (!isRecord(message)) return null;
	const model = message["model"];
	return typeof model === "string" && model !== "" && model !== SYNTHETIC_MODEL ? model : null;
}

function stopReason(record: RawRecord): unknown
{
	const message = record["message"];
	return isRecord(message) ? message["stop_reason"] : undefined;
}

/**
 * Port of upstream's `Ui`: walks back from `from`, skipping sidechain and `hidden` records, to the last
 * real prompt. The newest main-chain assistant record on the way must be a refusal. A synthetic refusal
 * row names no model, so the turn's newest older real assistant row supplies it, as upstream's `s ??=`.
 */
function scan(records: readonly RawRecord[], from: number, hidden: ReadonlySet<string>): HardBlock | null
{
	let block: Omit<HardBlock, "hasMessage"> | null = null;
	let promptUuid: string | undefined;
	for (let index = from; index >= 0; index--)
	{
		const record = records[index];
		if (record === undefined || record["isSidechain"] === true) continue;
		const uuid = record["uuid"];
		if (typeof uuid === "string" && hidden.has(uuid)) continue;
		if (record["isCompactSummary"] !== true && isPrompt(record))
		{
			promptUuid = typeof uuid === "string" ? uuid : undefined;
			break;
		}
		if (record["type"] !== "assistant") continue;
		if (block !== null)
		{
			block.model ??= recordModel(record);
			continue;
		}
		if (stopReason(record) !== "refusal" || typeof uuid !== "string") return null;
		block =
		{
			uuid,
			model: recordModel(record),
		};
	}
	if (block === null) return null;
	return {
		...block,
		hasMessage: promptUuid !== undefined && rewindTurns(records, hidden).at(-1)?.uuid === promptUuid,
	};
}

/** Upstream `Ki`: the newest turn's hard block, or null while a turn is in flight (`pendingTurn !== null`). */
export function latestHardBlock(
	records: readonly RawRecord[],
	{
		turnInFlight,
		hidden = new Set(),
	}:
	{
		turnInFlight: boolean;
		hidden?: ReadonlySet<string>;
	},
): HardBlock | null
{
	return turnInFlight ? null : scan(records, records.length - 1, hidden);
}

/** Upstream `Yi`: the hard block a specific refusal row ends its turn with, for an older card. */
export function hardBlockAt(
	records: readonly RawRecord[],
	uuid: string,
	hidden: ReadonlySet<string> = new Set(),
): HardBlock | null
{
	let index = records.findLastIndex((record) => record["uuid"] === uuid);
	if (index === -1) return null;
	// Upstream extends the anchor to the end of its turn, so a later reply in the turn disqualifies it.
	while (index + 1 < records.length && !isPrompt(records[index + 1] ?? {})) index++;
	const block = scan(records, index, hidden);
	return block?.uuid === uuid ? block : null;
}
