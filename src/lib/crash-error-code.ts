// Upstream's crash-screen error code (`w1`/`dh`/`Of`/`tU`) and its repeat-within-a-minute memory (`r9`/`Ox`).

const CRASH_CODE_SEEN_KEY = "global-error-seen";
const CRASH_CODE_REPEAT_MS = 60_000;

/** Drops the volatile parts of a message so the same crash hashes to the same code. */
export function normalizeCrashMessage(message: string): string
{
	return message
		.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
		.replace(/https?:\/\/\S+/g, "<link>")
		.replace(/\b[\w.-]*?-[A-Za-z0-9_]{8}\.(m?js|css)\b/g, "<chunk>.$1")
		.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<addr>")
		.replace(/\b[0-9a-f]{16,}\b/gi, "<hash>")
		.replace(/\b[A-Za-z_$][\w$]{0,2}\b/g, "_");
}

function djb2Xor(text: string): number
{
	let hash = 5381;
	for (let i = 0; i < text.length; i++) hash = (hash * 33) ^ text.charCodeAt(i);
	return hash >>> 0;
}

export interface CrashErrorCode
{
	code: string;
	displayCode: string;
}

export function crashErrorCode(error: Error): CrashErrorCode
{
	const message = normalizeCrashMessage(error.message || "unknown");
	const code = djb2Xor(error.name ? `${error.name}:${message}` : message)
		.toString(36)
		.toUpperCase()
		.padStart(7, "0");
	const digest: unknown = "digest" in error ? error.digest : undefined;
	return {
		code,
		displayCode: typeof digest === "string" && digest !== "" ? `${code}.${digest}` : code,
	};
}

export function crashCodeSeenRecently(code: string, now: number = Date.now()): boolean
{
	try
	{
		const stored = sessionStorage.getItem(CRASH_CODE_SEEN_KEY);
		if (!stored) return false;
		const parsed: unknown = JSON.parse(stored);
		if (typeof parsed !== "object" || parsed === null || !("code" in parsed) || !("time" in parsed)) return false;
		return parsed.code === code && typeof parsed.time === "number" && now - parsed.time < CRASH_CODE_REPEAT_MS;
	}
	catch
	{
		return false;
	}
}

export function rememberCrashCode(code: string, now: number = Date.now()): void
{
	try
	{
		sessionStorage.setItem(
			CRASH_CODE_SEEN_KEY,
			JSON.stringify(
				{
					code,
					time: now,
				},
			),
		);
	}
	catch
	{
		// Without storage the code just never shows.
	}
}
