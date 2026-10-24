import {isRecord} from "./narrow";

/** The settings.json keys that decide whether a fresh session starts in fast mode. */
export interface FastModeSettings {
	fastMode?: boolean | undefined;
	fastModePerSessionOptIn?: boolean | undefined;
}

/** The `message.usage.speed` of a main-thread assistant transcript entry, if it carries one. */
function assistantSpeed(entry: unknown): string | null {
	if (!isRecord(entry) || entry["type"] !== "assistant" || entry["isSidechain"] === true) return null;
	const message = entry["message"];
	if (!isRecord(message)) return null;
	const usage = message["usage"];
	if (!isRecord(usage)) return null;
	const speed = usage["speed"];
	return typeof speed === "string" ? speed : null;
}

/**
 * Whether a session is in fast mode: the last main-thread assistant turn's `usage.speed`
 * ("fast" / "standard"), or, before any turn, settings.json `fastMode` unless it is a per-session opt-in.
 */
export function sessionFastMode(entries: readonly unknown[], settings: FastModeSettings): boolean {
	for (let i = entries.length - 1; i >= 0; i--) {
		const speed = assistantSpeed(entries[i]);
		if (speed !== null) return speed === "fast";
	}
	return settings.fastMode === true && settings.fastModePerSessionOptIn !== true;
}
