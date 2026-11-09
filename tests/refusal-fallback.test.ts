import {describe, expect, it} from "vite-plus/test";

import {activeRefusalFallback} from "../src/lib/refusal-fallback";

type Rec = Record<string, unknown>;

function prompt(uuid: string, text = "hello"): Rec {
	return {type: "user", uuid, message: {role: "user", content: text}};
}

function toolResult(uuid: string): Rec {
	return {
		type: "user",
		uuid,
		message: {role: "user", content: [{type: "tool_result", tool_use_id: "t1", content: "ok"}]},
	};
}

function reply(uuid: string, model = "claude-sonnet-4-5-20250929"): Rec {
	return {type: "assistant", uuid, message: {role: "assistant", model, content: [{type: "text", text: "hi"}]}};
}

function turnEnd(uuid: string): Rec {
	return {type: "system", subtype: "turn_duration", uuid, durationMs: 1200};
}

function fallback(uuid: string, overrides: Rec = {}): Rec {
	return {
		type: "system",
		subtype: "model_refusal_fallback",
		uuid,
		originalModel: "claude-opus-4-5",
		fallbackModel: "claude-sonnet-4-5",
		trigger: "refusal",
		direction: "retry",
		scope: "local",
		requestId: "req_1",
		apiRefusalCategory: "cyber",
		apiRefusalExplanation: null,
		refusedUserMessageUuid: "u1",
		...overrides,
	};
}

describe("activeRefusalFallback", () => {
	it("returns a live retry fallback with strike 1 and the streak's original model", () => {
		const records = [prompt("u1"), fallback("f1")];
		expect(activeRefusalFallback(records, 0, 1)).toStrictEqual({
			originalModel: "claude-opus-4-5",
			fallbackModel: "claude-sonnet-4-5",
			apiRefusalCategory: "cyber",
			apiRefusalCategoryRaw: "cyber",
			refusedUserMessageUuid: "u1",
			strike: 1,
			streakOriginalModel: "claude-opus-4-5",
			uuid: "f1",
		});
	});

	it("keeps the fallback through the fallback model's own reply and tool results", () => {
		const records = [prompt("u1"), fallback("f1"), reply("a1"), toolResult("r1"), reply("a2")];
		expect(activeRefusalFallback(records, 0, 1)).toStrictEqual({
			originalModel: "claude-opus-4-5",
			fallbackModel: "claude-sonnet-4-5",
			apiRefusalCategory: "cyber",
			apiRefusalCategoryRaw: "cyber",
			refusedUserMessageUuid: "u1",
			strike: 1,
			streakOriginalModel: "claude-opus-4-5",
			uuid: "f1",
		});
	});

	it("ignores revert and sticky fallbacks", () => {
		expect(activeRefusalFallback([prompt("u1"), fallback("f1", {direction: "revert"})], 0, 0)).toBeNull();
		expect(activeRefusalFallback([prompt("u1"), fallback("f1", {direction: "sticky"})], 0, 0)).toBeNull();
	});

	it("ignores a fallback missing either model", () => {
		expect(activeRefusalFallback([fallback("f1", {fallbackModel: undefined})], 0, 0)).toBeNull();
	});

	it("is dismissed by the next human prompt", () => {
		expect(activeRefusalFallback([prompt("u1"), fallback("f1"), prompt("u2")], 0, 0)).toBeNull();
	});

	it("is not dismissed by a meta user record", () => {
		const records = [prompt("u1"), fallback("f1"), {...prompt("m1"), isMeta: true}];
		expect(activeRefusalFallback(records, 0, 0)?.uuid).toBe("f1");
	});

	it("never shows a fallback from before the page opened", () => {
		expect(activeRefusalFallback([prompt("u1"), fallback("f1")], 0, 2)).toBeNull();
	});

	it("uses session-absolute record indices", () => {
		expect(activeRefusalFallback([prompt("u1"), fallback("f1")], 100, 101)?.uuid).toBe("f1");
		expect(activeRefusalFallback([prompt("u1"), fallback("f1")], 100, 102)).toBeNull();
	});

	it("counts a second refused turn with no clean turn between as strike 2, keeping the first origin", () => {
		const records = [
			prompt("u1"),
			fallback("f1"),
			turnEnd("t1"),
			fallback("f2", {originalModel: "claude-sonnet-4-5", fallbackModel: "claude-haiku-4-5"}),
		];
		expect(activeRefusalFallback(records, 0, 0)).toStrictEqual({
			originalModel: "claude-sonnet-4-5",
			fallbackModel: "claude-haiku-4-5",
			apiRefusalCategory: "cyber",
			apiRefusalCategoryRaw: "cyber",
			refusedUserMessageUuid: "u1",
			strike: 2,
			streakOriginalModel: "claude-opus-4-5",
			uuid: "f2",
		});
	});

	it("counts consecutive refused turns across human prompts", () => {
		const records = [prompt("u1"), fallback("f1"), turnEnd("t1"), prompt("u2"), fallback("f2")];
		expect(activeRefusalFallback(records, 0, 0)?.strike).toBe(2);
	});

	it("resets the strike after a clean turn", () => {
		const records = [
			prompt("u1"),
			fallback("f1"),
			turnEnd("t1"),
			prompt("u2"),
			reply("a2"),
			turnEnd("t2"),
			prompt("u3"),
			fallback("f2", {originalModel: "claude-sonnet-4-5", refusedUserMessageUuid: "u3"}),
		];
		expect(activeRefusalFallback(records, 0, 0)).toStrictEqual({
			originalModel: "claude-sonnet-4-5",
			fallbackModel: "claude-sonnet-4-5",
			apiRefusalCategory: "cyber",
			apiRefusalCategoryRaw: "cyber",
			refusedUserMessageUuid: "u3",
			strike: 1,
			streakOriginalModel: "claude-sonnet-4-5",
			uuid: "f2",
		});
	});

	it("keeps an unknown category only as the raw string", () => {
		const records = [prompt("u1"), fallback("f1", {apiRefusalCategory: "weird", refusedUserMessageUuid: null})];
		expect(activeRefusalFallback(records, 0, 0)).toStrictEqual({
			originalModel: "claude-opus-4-5",
			fallbackModel: "claude-sonnet-4-5",
			apiRefusalCategory: null,
			apiRefusalCategoryRaw: "weird",
			refusedUserMessageUuid: null,
			strike: 1,
			streakOriginalModel: "claude-opus-4-5",
			uuid: "f1",
		});
	});

	it("reads a null category as null raw", () => {
		const records = [prompt("u1"), fallback("f1", {apiRefusalCategory: null})];
		expect(activeRefusalFallback(records, 0, 0)?.apiRefusalCategoryRaw).toBeNull();
	});

	it("is cleared when a later assistant reply runs on another model", () => {
		const records = [prompt("u1"), fallback("f1"), reply("a1", "claude-opus-4-5-20251101")];
		expect(activeRefusalFallback(records, 0, 0)).toBeNull();
	});

	it("is not cleared by a synthetic assistant record", () => {
		const records = [prompt("u1"), fallback("f1"), reply("a1", "<synthetic>")];
		expect(activeRefusalFallback(records, 0, 0)?.uuid).toBe("f1");
	});

	it("skips sidechain records and records on an abandoned branch", () => {
		const records = [prompt("u1"), fallback("f1"), {...prompt("s1"), isSidechain: true}, prompt("h1")];
		expect(activeRefusalFallback(records, 0, 0, new Set(["h1"]))?.uuid).toBe("f1");
	});
});
