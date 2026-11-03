/** Upstream's `qP`: the "API Error[ (NNN)]: " / "API NNN" / "Error: NNN {" prefix of an error's text. */
const ERROR_PREFIX =
	/^\s*(?:Claude Code returned an error result:\s*)?(?:API Error(?:\s*\((\d{3})\)|\s*\([^()\n]{1,80}\))?:?\s*|API\s+(?=\d{3}\b)|Error:\s+(?=\d{3}\s+[{[]))/i;

/** Upstream's `Qc`: a leading HTTP status before the message. */
const LEADING_STATUS = /^(\d{3})\s+(?=[A-Z[{(])/;

/** Upstream's `y9`: the trailing "Request ID:" (and "Message ID:") block the CLI appends. */
const ID_TRAILER = /(?:^|\n)[ \t]*Request ID:[ \t]*(\S+)(?=(?:\n+Message ID:[ \t]*(\S+))?$)/;

/** Upstream's `pW`: lines that each start an "API Error". */
const API_ERROR_LINE = /(?:^|\n)\s*(?:Claude Code returned an error result:\s*)?API Error/gi;

export interface ParsedApiErrorDetails {
	body: string;
	status?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Upstream's `nv`: a JSON error body's message — `error.message`, a string `error`, or `message`. */
function jsonMessage(line: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;
	const {error, message} = parsed;
	if (isRecord(error) && typeof error["message"] === "string") return error["message"];
	if (typeof error === "string") return error;
	return typeof message === "string" ? message : undefined;
}

/**
 * Upstream's `eX` for an error text (`detailsIsErrorText`, request id untrusted):
 * strips the API Error prefix and takes its status, unwraps a JSON body to its
 * message, and drops a trailing Request ID / Message ID block.
 */
export function parseApiErrorDetails(text: string): ParsedApiErrorDetails {
	let rest = text;
	const idTrailer = ID_TRAILER.exec(rest);
	if (idTrailer !== null) rest = rest.slice(0, idTrailer.index);
	let status: string | undefined;
	if ((text.match(API_ERROR_LINE) ?? []).length <= 1) {
		const prefix = ERROR_PREFIX.exec(rest);
		if (prefix !== null) {
			status = prefix[1];
			rest = rest.slice(prefix[0].length);
		}
	}
	const leading = LEADING_STATUS.exec(rest);
	if (leading !== null) {
		status ??= leading[1];
		rest = rest.slice(leading[0].length);
	}
	if (rest.startsWith("{") || rest.startsWith("[")) {
		const newline = rest.indexOf("\n");
		const [first, after] = newline === -1 ? [rest, ""] : [rest.slice(0, newline), rest.slice(newline)];
		const message = jsonMessage(first);
		if (message !== undefined) rest = message + after;
	}
	const body = rest.trim();
	return status === undefined ? {body} : {body, status};
}
