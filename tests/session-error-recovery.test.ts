import {describe, expect, it, vi} from "vite-plus/test";
import {
	errorRecoveryAvailability,
	errorRecoveryHandlers,
	switchModelForRetry,
	lastEntryIsError,
	type ErrorRecoveryGate,
} from "../src/lib/session-error-recovery";
import {processTranscript} from "../src/lib/transcript";

const OPEN: ErrorRecoveryGate = {
	hasLivePane: true,
	writesEnabled: true,
	paneStatus: "idle",
	pendingCard: false,
	isPending: false,
	isLastEntry: true,
};

const ERROR_RECORD = {
	type: "assistant",
	uuid: "a1",
	timestamp: "2026-09-22T01:08:50.253Z",
	message: {
		id: "m1",
		model: "<synthetic>",
		role: "assistant",
		stop_reason: "stop_sequence",
		type: "message",
		content: [{type: "text", text: "API Error: 529 Overloaded."}],
	},
	isApiErrorMessage: true,
	apiErrorStatus: 529,
};

function prompt(uuid: string, text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type: "user",
		uuid,
		timestamp: "2026-09-22T01:08:40.000Z",
		message: {role: "user", content: text},
		...extra,
	};
}

describe("errorRecoveryAvailability", () => {
	it("is retryable and idle with a live writable idle pane, no pending card or send, on the last entry", () => {
		expect(errorRecoveryAvailability(OPEN)).toStrictEqual({retryable: true, idle: true});
	});

	it.each<[string, Partial<ErrorRecoveryGate>]>([
		["no live pane", {hasLivePane: false}],
		["terminal writes off", {writesEnabled: false}],
		["pane working", {paneStatus: "working"}],
		["pending question, permission or plan card", {pendingCard: true}],
		["a send in flight", {isPending: true}],
		["not the last entry", {isLastEntry: false}],
	])("offers nothing with %s", (_name, override) => {
		expect(errorRecoveryAvailability({...OPEN, ...override})).toStrictEqual({retryable: false, idle: false});
	});
});

describe("errorRecoveryHandlers", () => {
	it("returns no recovery when the session is neither retryable nor idle", () => {
		const send = vi.fn<(text: string) => Promise<"sent" | "not-ready" | "failed">>(async () =>
			Promise.resolve("sent"),
		);
		expect(errorRecoveryHandlers({retryable: false, idle: false}, send, vi.fn<(text: string) => void>())).toBe(
			undefined,
		);
	});

	it("types exactly Try again and /compact into the pane", async () => {
		const send = vi.fn<(text: string) => Promise<"sent" | "not-ready" | "failed">>(async () =>
			Promise.resolve("sent"),
		);
		const enqueue = vi.fn<(text: string) => void>();
		const recovery = errorRecoveryHandlers({retryable: true, idle: true}, send, enqueue);
		recovery?.onRetry?.();
		recovery?.onCompact?.();
		await Promise.resolve();
		expect({sent: send.mock.calls, queued: enqueue.mock.calls}).toStrictEqual({
			sent: [["Try again"], ["/compact"]],
			queued: [],
		});
	});

	it("queues the prompt when the pane's agent is not ready, like the composer's send", async () => {
		const send = vi.fn<(text: string) => Promise<"sent" | "not-ready" | "failed">>(async () =>
			Promise.resolve("not-ready"),
		);
		const enqueue = vi.fn<(text: string) => void>();
		errorRecoveryHandlers({retryable: true, idle: true}, send, enqueue)?.onRetry?.();
		await vi.waitFor(() => {
			expect(enqueue.mock.calls).toStrictEqual([["Try again"]]);
		});
	});
});

describe("errorRecoveryHandlers rewind", () => {
	const send = async (): Promise<"sent"> => Promise.resolve("sent");

	it("hands the card the rewind picker opener on a retryable session", () => {
		const openRewindPicker = vi.fn<() => void>();
		errorRecoveryHandlers(
			{retryable: true, idle: true},
			send,
			vi.fn<(text: string) => void>(),
			undefined,
			openRewindPicker,
		)?.onRewind?.();
		expect(openRewindPicker.mock.calls).toStrictEqual([[]]);
	});

	it("offers no rewind when the session is not retryable, or without an opener", () => {
		const openRewindPicker = vi.fn<() => void>();
		expect({
			closed: errorRecoveryHandlers(
				{retryable: false, idle: false},
				send,
				vi.fn<(text: string) => void>(),
				undefined,
				openRewindPicker,
			),
			noOpener: errorRecoveryHandlers({retryable: true, idle: true}, send, vi.fn<(text: string) => void>())
				?.onRewind,
		}).toStrictEqual({closed: undefined, noOpener: undefined});
	});
});

describe("lastEntryIsError", () => {
	it("is true when the API error is the transcript's last entry, past trailing system records", () => {
		const {lines} = processTranscript([
			prompt("u1", "hello"),
			ERROR_RECORD,
			{
				type: "system",
				subtype: "turn_duration",
				uuid: "s1",
				timestamp: "2026-09-22T01:08:51.000Z",
				durationMs: 5,
			},
		]);
		expect(lastEntryIsError(lines)).toBe(true);
	});

	it("skips meta user lines after the error", () => {
		const {lines} = processTranscript([
			prompt("u1", "hello"),
			ERROR_RECORD,
			prompt("u2", "<local-command-caveat>x</local-command-caveat>", {isMeta: true}),
		]);
		expect(lastEntryIsError(lines)).toBe(true);
	});

	it("is false once a later prompt follows the error", () => {
		const {lines} = processTranscript([prompt("u1", "hello"), ERROR_RECORD, prompt("u2", "Try again")]);
		expect(lastEntryIsError(lines)).toBe(false);
	});

	it("is false without an error", () => {
		const {lines} = processTranscript([prompt("u1", "hello")]);
		expect(lastEntryIsError(lines)).toBe(false);
	});
});

describe("switchModelForRetry", () => {
	it("applies the model as a live option and reports success", async () => {
		const sent: unknown[] = [];
		const toast = vi.fn<(options: unknown) => void>();
		const ok = await switchModelForRetry("s1", "sonnet", {
			send: async (sessionId, change) => {
				sent.push([sessionId, change]);
				return Promise.resolve();
			},
			toast,
		});
		expect({ok, sent, toasts: toast.mock.calls}).toStrictEqual({
			ok: true,
			sent: [["s1", {kind: "model", model: "sonnet"}]],
			toasts: [],
		});
	});

	it("toasts the chin's model failure copy and reports failure when the live option is rejected", async () => {
		const toast = vi.fn<(options: unknown) => void>();
		const ok = await switchModelForRetry("s1", "sonnet", {
			send: async () => Promise.reject(new Error("pane gone")),
			toast,
		});
		expect({ok, toasts: toast.mock.calls}).toStrictEqual({
			ok: false,
			toasts: [
				[
					{
						kind: "error",
						message: "Model change couldn’t be applied. You can try again.",
						description: "pane gone",
					},
				],
			],
		});
	});
});
