import {isUsageLimitText} from "./usage-limit-notice";

/**
 * Upstream's API-error categories (shared-3 `MQ`) that a CLI JSONL error
 * record can reach. The marker-only ones (`org_policy_denied` and the `jW`
 * markers) and the model-gate ones (`model_requires_automode`,
 * `model_requires_strict_sandbox`) come from the desktop host, never from a
 * transcript, so they are left out.
 */
export type ApiErrorCategory =
	| "rate_limit"
	| "server_rate_limit"
	| "image_dimension"
	| "overloaded"
	| "server_error"
	| "stream_idle_timeout"
	| "network"
	| "auth"
	| "context_length"
	| "usage_policy"
	| "org_disabled"
	| "invalid_request"
	| "image_invalid"
	| "request_too_large"
	| "model_not_found"
	| "output_token_limit"
	| "extra_usage_required"
	| "billing"
	| "permission"
	| "unknown";

export interface ApiErrorInput {
	/** The message text, e.g. "API Error: 529 Overloaded…". */
	text: string;
	/** The JSONL record's `error` code, e.g. `authentication_failed`. */
	code?: string;
	/** The JSONL record's `apiErrorStatus`. */
	status?: number;
	/** The assistant message's `stop_reason`. */
	stopReason?: string;
}

/**
 * Upstream's `fn` text table, in order. Four entries reference regexes the
 * dumped chunk doesn't define (`VW`, `jt` model gates, `Xg` model-not-found,
 * `NK` billing, `_w` permission); the gates can't come from a transcript and
 * the other three still have the textual rows that follow them.
 */
const TEXT_CATEGORIES: ReadonlyArray<readonly [RegExp, ApiErrorCategory]> = [
	[/exceeds the dimension limit|\bImage was too large\b/i, "image_dimension"],
	[
		/hit your (?:org's )?(?:monthly )?(?:usage )?limit|out of (?:extra )?usage|usage allocation|monthly usage limit|group's usage limit|(?<!not your )usage limit/i,
		"rate_limit",
	],
	[/rate_limit_error|\btemporarily limiting\b/i, "server_rate_limit"],
	[
		/\bStream idle timeout\b|\bresponse (?:stopped arriving|stalled before)|\bwent to sleep (?:mid-response|before a response)/i,
		"stream_idle_timeout",
	],
	[/overloaded_error|\bOverloaded\b/i, "overloaded"],
	[/\bPrompt is too long\b|Autocompact is thrashing/i, "context_length"],
	[/\bRequest too large\b/i, "request_too_large"],
	[
		/Usage Policy|content filtering policy|specific safety measures|safeguards flagged this (?:message|session)|Cyber Verification Program|anthropic\.com\/legal\/aup/i,
		"usage_policy",
	],
	[
		/organization has been disabled|organization does not have access|disabled Claude subscription|service is disabled for your org/i,
		"org_disabled",
	],
	[/Could not process image|image .* could not be processed|PDF is password protected/i, "image_invalid"],
	[/selected model|model not found|is not a valid model|model does not exist/i, "model_not_found"],
	[/exceeded the \d+ output token/i, "output_token_limit"],
	[/Extra usage is required|Usage credits required for 1M context/i, "extra_usage_required"],
	[
		/socket connection was closed|ECONNRESET|ECONNREFUSED|ConnectionRefused|Unable to connect|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|certificate verification|Request timed out|Connection lost (?:mid-response|before a response)|Can't reach the API server — |No internet route — |Connection dropped \([A-Za-z_]+\)|Connection refused — a firewall or proxy/i,
		"network",
	],
	[/authentication_error|Failed to authenticate|Invalid API Key|\bOAuth token has expired\b/i, "auth"],
	[/Internal server error|Server error mid-response|Bad Gateway|"api_error"/i, "server_error"],
	[/permission_error/i, "permission"],
	[/invalid_request_error/i, "invalid_request"],
];

/** Upstream's `D$`: the JSONL `error` code's category. */
const CODE_CATEGORIES: Readonly<Record<string, ApiErrorCategory>> = {
	rate_limit: "server_rate_limit",
	authentication_failed: "auth",
	billing_error: "billing",
	invalid_request: "invalid_request",
	server_error: "server_error",
	max_output_tokens: "output_token_limit",
	model_not_found: "model_not_found",
	oauth_org_not_allowed: "org_disabled",
	verification_required: "unknown",
	overloaded_error: "overloaded",
	overloaded: "overloaded",
};

/** Upstream's `He`: codes that win over the message text. */
const DECISIVE_CODES = new Set([
	"model_not_found",
	"oauth_org_not_allowed",
	"overloaded",
	"overloaded_error",
	"max_output_tokens",
]);

/** Upstream's `RF`: an HTTP status named in the message text. */
const TEXT_STATUS = /(?:API error:?|HTTP(?:\/\d(?:\.\d)?)?|status(?:\s*code)?:?)\s*(4\d{2}|5\d{2})\b/i;

function codeCategory(code: string | undefined): ApiErrorCategory | undefined {
	return code !== undefined && Object.hasOwn(CODE_CATEGORIES, code) ? CODE_CATEGORIES[code] : undefined;
}

/** Upstream's `Ao`: an HTTP status's category. */
function statusCategory(status: number): ApiErrorCategory {
	if (status === 429) return "server_rate_limit";
	if (status === 529) return "overloaded";
	if (status >= 500) return "server_error";
	if (status === 401) return "auth";
	if (status === 402) return "billing";
	if (status === 403) return "permission";
	if (status === 413) return "request_too_large";
	if (status >= 400) return "invalid_request";
	return "unknown";
}

/** Upstream's `MQ`, in its order: refusal, usage-limit text, decisive codes, the text table, the code map, then the status. */
export function classifyApiError({text, code, status, stopReason}: ApiErrorInput): ApiErrorCategory {
	if (stopReason === "refusal") return "usage_policy";
	if (isUsageLimitText(text)) return "rate_limit";
	if (code !== undefined && DECISIVE_CODES.has(code)) {
		const decisive = codeCategory(code);
		if (decisive !== undefined) return decisive;
	}
	const fromText = TEXT_CATEGORIES.find(([pattern]) => pattern.test(text))?.[1];
	if (fromText !== undefined) return fromText;
	const fromCode = codeCategory(code);
	if (fromCode !== undefined) return fromCode;
	const resolvedStatus = status ?? numberOrUndefined(TEXT_STATUS.exec(text)?.[1]);
	return resolvedStatus === undefined ? "unknown" : statusCategory(resolvedStatus);
}

function numberOrUndefined(value: string | undefined): number | undefined {
	return value === undefined ? undefined : Number(value);
}

/** The trailing "Request ID:" / "Message ID:" paragraphs the CLI appends to an error's text. */
const ID_TRAILER = /(?:\n\n(?:Request|Message) ID: [^\n]*)+$/;

/** Upstream's `Mr` suffix: the "Details: `[category]`" paragraph ending a refusal's text. */
const DETAILS_SUFFIX = /\n\nDetails: `\[([^`[\]\n]+)\]`$/;

export interface RefusalPassthrough {
	body: string;
	category?: string;
}

/**
 * Upstream's `Mr`: a refusal's own explanation, which replaces the usage-policy
 * hint. It drops the "API Error:" prefix and splits off the Details category.
 * Upstream first strips the error text in a chunk the dumps leave out; this
 * strips the Request ID and Message ID trailer, which the details lines show.
 */
export function refusalPassthrough(text: string): RefusalPassthrough | undefined {
	const trimmed = text
		.replace(ID_TRAILER, "")
		.replace(/^API Error:?\s*/i, "")
		.trim();
	const details = DETAILS_SUFFIX.exec(trimmed);
	const body = details ? trimmed.slice(0, details.index).trim() : trimmed;
	if (body === "") return undefined;
	return {body, ...(details?.[1] !== undefined && {category: details[1]})};
}

/** Upstream's `er`: whether View details keeps, drops, or describes the raw body. */
export type DetailsVerdict = "keep" | "drop" | "describe";

interface CategoryCopy {
	headline: string;
	/** Upstream's `fr`: a past-tense label for an earlier, collapsed error. */
	markerLabel?: string;
	hint: string;
	hintNoRewind?: string;
	hintWithoutRetry?: string;
	hintWithoutComposer?: string;
	learnMoreUrl?: string;
	detailsVerdict: DetailsVerdict;
}

/** Upstream's `gr` table: headlines from shared-14 `q`, hints from c797f68e4 `Q`. */
const COPY: Readonly<Record<ApiErrorCategory, CategoryCopy>> = {
	rate_limit: {
		headline: "Usage limit reached",
		hint: "You’ve reached your usage limit. Try again after your limit resets.",
		hintWithoutRetry: "You’ve reached your usage limit. Send a message after your limit resets.",
		hintWithoutComposer: "Wait for your usage limit to reset.",
		detailsVerdict: "drop",
	},
	server_rate_limit: {
		headline: "Server is temporarily limiting requests",
		markerLabel: "Server was temporarily limiting requests",
		hint: "Too many requests right now. Try again in a moment.",
		hintWithoutRetry: "Too many requests right now. Wait a moment, then send a message to try again.",
		hintWithoutComposer: "Too many requests right now. This usually clears in a moment.",
		detailsVerdict: "drop",
	},
	image_dimension: {
		headline: "Image is too large",
		hint: "An image in this conversation is over 2000px. Rewind to remove it, or start a new session.",
		hintNoRewind: "An image in this conversation is over 2000px. Start a new session to continue.",
		detailsVerdict: "drop",
	},
	overloaded: {
		headline: "Service is busy",
		markerLabel: "Service was busy",
		hint: "Try again in a moment, or switch to a different model.",
		hintWithoutRetry: "You can send a message to try again in a moment, or switch to a different model.",
		hintWithoutComposer: "This is usually temporary.",
		detailsVerdict: "drop",
	},
	server_error: {
		headline: "Server error",
		hint: "The server returned an error while handling this message. It’s usually temporary.",
		detailsVerdict: "drop",
	},
	stream_idle_timeout: {
		headline: "Connection went idle",
		hint: "The response stopped before finishing. Try again in a moment.",
		hintWithoutRetry: "The response stopped before finishing. Wait a moment, then send a message to try again.",
		hintWithoutComposer: "The response stopped before finishing. This is usually temporary.",
		detailsVerdict: "drop",
	},
	network: {
		headline: "Connection problem",
		hint: "Check your internet connection, VPN, or proxy and try again.",
		hintWithoutRetry: "Check your internet connection, VPN, or proxy, then send a message to try again.",
		hintWithoutComposer: "Check your internet connection, VPN, or proxy.",
		detailsVerdict: "keep",
	},
	auth: {headline: "Authentication failed", hint: "Sign in again to continue.", detailsVerdict: "drop"},
	context_length: {
		headline: "Your context window is full",
		markerLabel: "Context window was full",
		hint: "This chat is too long to continue. Compact it to summarize earlier messages and keep going, rewind to an earlier point, or start a new chat.",
		hintNoRewind: "This chat is too long to continue. Start a new chat.",
		detailsVerdict: "drop",
	},
	usage_policy: {
		headline: "Message flagged",
		hint: "Claude’s safeguards flagged this message. This sometimes happens in safe, normal sessions. Rephrase your message or rewind to continue.",
		hintNoRewind:
			"Claude’s safeguards flagged this message. This sometimes happens in safe, normal sessions. Switch models to continue.",
		learnMoreUrl: "https://www.anthropic.com/legal/aup",
		detailsVerdict: "describe",
	},
	org_disabled: {
		headline: "Organization access is disabled",
		hint: "Your organization’s access has been disabled. Contact your admin.",
		detailsVerdict: "keep",
	},
	invalid_request: {headline: "Invalid request", hint: "The request couldn’t be completed.", detailsVerdict: "keep"},
	image_invalid: {
		headline: "Image couldn’t be processed",
		hint: "An image couldn’t be read. Rewind to remove it and try a different format.",
		hintNoRewind: "An image couldn’t be read. Start a new session to continue.",
		detailsVerdict: "drop",
	},
	request_too_large: {
		headline: "Request is too large",
		hint: "An attachment is too large. Rewind to remove it, then send your message again.",
		hintNoRewind: "An attachment is too large. Start a new session to continue.",
		detailsVerdict: "drop",
	},
	model_not_found: {
		headline: "Model isn’t available",
		hint: "Switch to a different model to continue.",
		detailsVerdict: "keep",
	},
	output_token_limit: {
		headline: "Response exceeded the output limit",
		hint: "Ask Claude to continue, or break the task into smaller steps.",
		detailsVerdict: "drop",
	},
	extra_usage_required: {
		headline: "Extra usage is required",
		hint: "Enable extra usage in Settings, or switch to a model with standard context.",
		detailsVerdict: "drop",
	},
	billing: {headline: "Billing issue", hint: "Add credits or update billing to continue.", detailsVerdict: "drop"},
	permission: {
		headline: "Access denied",
		hint: "You don’t have access to this resource — check your permissions.",
		detailsVerdict: "keep",
	},
	unknown: {headline: "An API error occurred", hint: "Try sending your message again.", detailsVerdict: "keep"},
};

/** Upstream's `jr`: categories a rewind can clear. */
const REWIND_HELPS: ReadonlySet<ApiErrorCategory> = new Set([
	"image_dimension",
	"image_invalid",
	"context_length",
	"usage_policy",
	"request_too_large",
]);

export interface ErrorCopyContext {
	/** The session can open the rewind picker. */
	canRewind: boolean;
	/** The card offers Try again. */
	canRetry: boolean;
	/** The session has a live composer to send a new message from. */
	hasComposer: boolean;
}

export interface ErrorCopy {
	headline: string;
	markerLabel: string;
	hint: string;
	learnMoreUrl?: string;
	rewindHelps: boolean;
	detailsVerdict: DetailsVerdict;
}

/**
 * Upstream's `Nr` copy for a category, with the hint the card would show:
 * the no-rewind variant when the session can't rewind, then the retry hint,
 * the without-retry hint when there is a composer but no Try again, or the
 * without-composer hint when there is neither.
 */
export function errorCopy(category: ApiErrorCategory, {canRewind, canRetry, hasComposer}: ErrorCopyContext): ErrorCopy {
	const copy = COPY[category];
	const hint = !canRewind && copy.hintNoRewind !== undefined ? copy.hintNoRewind : copy.hint;
	const shown = canRetry ? hint : hasComposer ? (copy.hintWithoutRetry ?? hint) : (copy.hintWithoutComposer ?? hint);
	return {
		headline: copy.headline,
		markerLabel: copy.markerLabel ?? copy.headline,
		hint: shown,
		...(copy.learnMoreUrl !== undefined && {learnMoreUrl: copy.learnMoreUrl}),
		rewindHelps: REWIND_HELPS.has(category),
		detailsVerdict: copy.detailsVerdict,
	};
}
