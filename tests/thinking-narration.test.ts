import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {isNarrationThinking, narrationProse} from "../src/lib/thinking-narration";

interface SignatureFixture {
	source: string;
	kind: string;
	signature: string;
}

const FIXTURES = JSON.parse(readFileSync(join(__dirname, "fixtures", "thinking-signatures.json"), "utf8")) as {
	emptyThinking: SignatureFixture;
	realThinking: SignatureFixture;
	narrations: SignatureFixture[];
};

const thinking = (text: string, signature: string) => ({type: "thinking", thinking: text, signature});

describe("isNarrationThinking", () => {
	it("recognises the narration signatures copied from 54e53f89 and rejects real thinking signatures", () => {
		expect({
			narrations: FIXTURES.narrations.map(({source, signature}) => ({
				source,
				narration: isNarrationThinking(thinking("Fabricated narration.", signature)),
			})),
			emptyThinking: isNarrationThinking(thinking("", FIXTURES.emptyThinking.signature)),
			realThinking: isNarrationThinking(thinking("Fabricated pondering.", FIXTURES.realThinking.signature)),
		}).toStrictEqual({
			narrations: [
				{source: "54e53f89 line 336", narration: true},
				{source: "54e53f89 line 1428", narration: true},
				{source: "54e53f89 line 1449", narration: true},
			],
			emptyThinking: false,
			realThinking: false,
		});
	});

	it("rejects a missing, empty, non-base64 or truncated signature and any block that is not thinking", () => {
		const narration = FIXTURES.narrations[0]!.signature;
		const textBlock = {type: "text", text: "Fabricated", signature: narration};
		const redactedBlock = {type: "redacted_thinking", data: "Fabricated", signature: narration};
		expect([
			isNarrationThinking({type: "thinking", thinking: "Fabricated"}),
			isNarrationThinking(thinking("Fabricated", "")),
			isNarrationThinking(thinking("Fabricated", "!!! not base64 !!!")),
			isNarrationThinking(thinking("Fabricated", narration.slice(0, 40))),
			isNarrationThinking(textBlock),
			isNarrationThinking(redactedBlock),
		]).toStrictEqual([false, false, false, false, false, false]);
	});
});

describe("narrationProse", () => {
	it("returns the trimmed-non-empty prose of a narration block and null for empty narration or real thinking", () => {
		const narration = FIXTURES.narrations[0]!.signature;
		const textBlock = {type: "text", text: "Fabricated"};
		expect([
			narrationProse(thinking("Found the fabricated bug.", narration)),
			narrationProse(thinking("  \n", narration)),
			narrationProse(thinking("Fabricated pondering.", FIXTURES.realThinking.signature)),
			narrationProse(textBlock),
		]).toStrictEqual(["Found the fabricated bug.", null, null, null]);
	});
});
