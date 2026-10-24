import {describe, expect, it} from "vite-plus/test";

import {sessionFastMode} from "../src/lib/session-fast-mode";

function assistant(speed: string, extra: Record<string, unknown> = {}) {
	return {
		type: "assistant",
		uuid: `a-${speed}`,
		timestamp: "2026-10-24T10:00:00.000Z",
		message: {role: "assistant", content: [], usage: {input_tokens: 1, output_tokens: 1, speed}},
		...extra,
	};
}

const user = {type: "user", uuid: "u1", message: {role: "user", content: "hi"}};

describe("sessionFastMode", () => {
	it("is on when the last assistant entry ran at fast speed", () => {
		expect(sessionFastMode([assistant("standard"), user, assistant("fast")], {})).toBe(true);
	});

	it("is off when the last assistant entry ran at standard speed, whatever the settings say", () => {
		expect(sessionFastMode([assistant("fast"), user, assistant("standard")], {fastMode: true})).toBe(false);
	});

	it("falls back to settings fastMode with no assistant entries", () => {
		expect(sessionFastMode([user], {fastMode: true})).toBe(true);
		expect(sessionFastMode([], {fastMode: false})).toBe(false);
		expect(sessionFastMode([], {})).toBe(false);
	});

	it("does not carry settings fastMode into a fresh session when it is a per-session opt-in", () => {
		expect(sessionFastMode([], {fastMode: true, fastModePerSessionOptIn: true})).toBe(false);
	});

	it("ignores sidechain (subagent) assistant entries", () => {
		expect(sessionFastMode([assistant("standard"), assistant("fast", {isSidechain: true})], {})).toBe(false);
		expect(sessionFastMode([assistant("fast", {isSidechain: true})], {fastMode: false})).toBe(false);
	});

	it("skips assistant entries that carry no usage speed", () => {
		const noSpeed = {
			type: "assistant",
			uuid: "a3",
			message: {role: "assistant", content: [], usage: {input_tokens: 1}},
		};
		expect(sessionFastMode([assistant("fast"), noSpeed], {})).toBe(true);
	});
});
