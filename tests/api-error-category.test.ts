import {describe, expect, it} from "vite-plus/test";
import {classifyApiError, errorCopy, type ApiErrorInput} from "../src/lib/api-error-category";

const VIEWER = {canRewind: false, canRetry: false, hasComposer: false} as const;

function classify(input: Partial<ApiErrorInput>) {
	return classifyApiError({text: "", ...input});
}

describe("classifyApiError", () => {
	it("reads every local JSONL specimen into upstream's category", () => {
		expect([
			classify({
				text: "API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.",
			}),
			classify({text: "Can't reach the API server — check your internet connection, VPN, or proxy (ENOTFOUND)"}),
			classify({text: "API Error: Connection lost mid-response · check your network"}),
			classify({text: "API Error: Your computer went to sleep mid-response · send a message to retry"}),
			classify({text: "API Error: The response stopped arriving · retry in a moment"}),
			classify({text: "Login expired · Please run /login", code: "authentication_failed", status: 401}),
			classify({text: "", stopReason: "refusal"}),
			classify({
				text: 'API Error: 413 {"type":"error","error":{"type":"request_too_large","message":"Request too large"}}',
			}),
			classify({
				text: "API Error: 400 messages.0.content.1.image.source.base64.data: At least one of the image dimensions exceed max allowed size: 2576 pixels exceeds the dimension limit of 2000 pixels",
			}),
			classify({text: "Something odd happened", status: 500}),
			classify({text: "Something odd happened"}),
		]).toStrictEqual([
			"overloaded",
			"network",
			"network",
			"stream_idle_timeout",
			"stream_idle_timeout",
			"auth",
			"usage_policy",
			"request_too_large",
			"image_dimension",
			"server_error",
			"unknown",
		]);
	});

	it("follows upstream's MQ order: refusal, usage-limit text, the He codes, the text table, the code map, then the status", () => {
		expect([
			classify({text: "API Error: 529 Overloaded", stopReason: "refusal"}),
			classify({text: "You've hit your weekly limit · resets Oct 20 at 4am", code: "overloaded_error"}),
			classify({text: "Request too large", code: "overloaded_error"}),
			classify({text: "Request too large", code: "server_error"}),
			classify({text: "nothing recognisable", code: "billing_error", status: 500}),
			classify({text: "nothing recognisable", code: "verification_required"}),
			classify({text: "API Error: 429 nothing recognisable"}),
			classify({text: "nothing recognisable", status: 403}),
			classify({text: "nothing recognisable", status: 413}),
			classify({text: "nothing recognisable", status: 422}),
			classify({text: "nothing recognisable", status: 402}),
			classify({text: "nothing recognisable", status: 529}),
			classify({text: "HTTP 503 nothing recognisable"}),
			classify({text: '{"type":"error","error":{"type":"invalid_request_error"}}'}),
			classify({text: "Prompt is too long"}),
			classify({text: "Claude Code returned an error result: exceeded the 32000 output token maximum"}),
		]).toStrictEqual([
			"usage_policy",
			"rate_limit",
			"overloaded",
			"request_too_large",
			"billing",
			"unknown",
			"server_rate_limit",
			"permission",
			"request_too_large",
			"invalid_request",
			"billing",
			"overloaded",
			"server_error",
			"invalid_request",
			"context_length",
			"output_token_limit",
		]);
	});
});

describe("errorCopy", () => {
	it("gives the viewer upstream's no-rewind, no-composer copy for each specimen category", () => {
		expect([
			errorCopy("overloaded", VIEWER),
			errorCopy("network", VIEWER),
			errorCopy("stream_idle_timeout", VIEWER),
			errorCopy("auth", VIEWER),
			errorCopy("usage_policy", VIEWER),
			errorCopy("request_too_large", VIEWER),
			errorCopy("image_dimension", VIEWER),
			errorCopy("server_error", VIEWER),
			errorCopy("unknown", VIEWER),
		]).toStrictEqual([
			{
				headline: "Service is busy",
				markerLabel: "Service was busy",
				hint: "This is usually temporary.",
				rewindHelps: false,
				detailsVerdict: "drop",
			},
			{
				headline: "Connection problem",
				markerLabel: "Connection problem",
				hint: "Check your internet connection, VPN, or proxy.",
				rewindHelps: false,
				detailsVerdict: "keep",
			},
			{
				headline: "Connection went idle",
				markerLabel: "Connection went idle",
				hint: "The response stopped before finishing. This is usually temporary.",
				rewindHelps: false,
				detailsVerdict: "drop",
			},
			{
				headline: "Authentication failed",
				markerLabel: "Authentication failed",
				hint: "Sign in again to continue.",
				rewindHelps: false,
				detailsVerdict: "drop",
			},
			{
				headline: "Message flagged",
				markerLabel: "Message flagged",
				hint: "Claude’s safeguards flagged this message. This sometimes happens in safe, normal sessions. Switch models to continue.",
				learnMoreUrl: "https://www.anthropic.com/legal/aup",
				rewindHelps: true,
				detailsVerdict: "describe",
			},
			{
				headline: "Request is too large",
				markerLabel: "Request is too large",
				hint: "An attachment is too large. Start a new session to continue.",
				rewindHelps: true,
				detailsVerdict: "drop",
			},
			{
				headline: "Image is too large",
				markerLabel: "Image is too large",
				hint: "An image in this conversation is over 2000px. Start a new session to continue.",
				rewindHelps: true,
				detailsVerdict: "drop",
			},
			{
				headline: "Server error",
				markerLabel: "Server error",
				hint: "The server returned an error while handling this message. It’s usually temporary.",
				rewindHelps: false,
				detailsVerdict: "drop",
			},
			{
				headline: "An API error occurred",
				markerLabel: "An API error occurred",
				hint: "Try sending your message again.",
				rewindHelps: false,
				detailsVerdict: "keep",
			},
		]);
	});

	it("picks the retry, without-retry, or no-rewind hint the way upstream's card does", () => {
		expect([
			errorCopy("network", {canRewind: false, canRetry: true, hasComposer: true}).hint,
			errorCopy("network", {canRewind: false, canRetry: false, hasComposer: true}).hint,
			errorCopy("server_rate_limit", {canRewind: false, canRetry: false, hasComposer: true}).hint,
			errorCopy("server_rate_limit", VIEWER).markerLabel,
			errorCopy("context_length", VIEWER).markerLabel,
			errorCopy("context_length", VIEWER).hint,
			errorCopy("context_length", {canRewind: true, canRetry: false, hasComposer: true}).hint,
			errorCopy("auth", {canRewind: false, canRetry: false, hasComposer: true}).hint,
		]).toStrictEqual([
			"Check your internet connection, VPN, or proxy and try again.",
			"Check your internet connection, VPN, or proxy, then send a message to try again.",
			"Too many requests right now. Wait a moment, then send a message to try again.",
			"Server was temporarily limiting requests",
			"Context window was full",
			"This chat is too long to continue. Start a new chat.",
			"This chat is too long to continue. Compact it to summarize earlier messages and keep going, rewind to an earlier point, or start a new chat.",
			"Sign in again to continue.",
		]);
	});
});
