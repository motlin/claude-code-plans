import {describe, expect, it} from "vite-plus/test";
import {MAX_SPEECH_CHUNK, speechChunks} from "../src/lib/speech-chunks";

describe("speechChunks", () => {
	it("splits prose into sentences and paragraphs, dropping blank space", () => {
		expect(
			speechChunks("First sentence. Second one?  Third!\n\nA new paragraph\nwith a wrapped line.\n"),
		).toStrictEqual(["First sentence.", "Second one?", "Third!", "A new paragraph", "with a wrapped line."]);
	});

	it("breaks a sentence too long for one utterance at word boundaries", () => {
		const words = Array.from({length: 120}, (_, index) => `word${index}`);
		const chunks = speechChunks(`${words.join(" ")}.`);

		expect({
			allShort: chunks.every((chunk) => chunk.length <= MAX_SPEECH_CHUNK),
			several: chunks.length > 1,
			rejoined: chunks.join(" "),
		}).toStrictEqual({allShort: true, several: true, rejoined: `${words.join(" ")}.`});
	});

	it("prefers a comma or semicolon to a bare space when it breaks a long sentence", () => {
		const clause = "this clause runs on for a while without stopping";
		const chunks = speechChunks(`${clause}, ${clause}; ${clause}, ${clause}, ${clause}.`);

		expect(chunks.slice(0, -1).every((chunk) => /[,;]$/.test(chunk))).toStrictEqual(true);
	});

	it("returns nothing for blank text", () => {
		expect(speechChunks(" \n\n ")).toStrictEqual([]);
	});
});
