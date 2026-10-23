import {describe, expect, it} from "vite-plus/test";

import {
	type AcceptedMention,
	mentionAt,
	mentionEndingAt,
	mentionStartingAt,
	remapMentions,
} from "../src/lib/composer-mentions";

const aTs: AcceptedMention = {start: 4, end: 9, relPath: "a.ts", isDirectory: false};

describe("remapMentions", () => {
	it("keeps a range when the edit is after it", () => {
		expect(remapMentions("see @a.ts x", "see @a.ts xy", [aTs])).toStrictEqual([aTs]);
	});

	it("shifts a range when text is inserted before it", () => {
		expect(remapMentions("see @a.ts", "hi see @a.ts", [aTs])).toStrictEqual([
			{start: 7, end: 12, relPath: "a.ts", isDirectory: false},
		]);
	});

	it("shifts a range when text is deleted before it", () => {
		expect(remapMentions("see @a.ts", "e @a.ts", [aTs])).toStrictEqual([
			{start: 2, end: 7, relPath: "a.ts", isDirectory: false},
		]);
	});

	it("drops a range when the edit is strictly inside it", () => {
		expect(remapMentions("see @a.ts", "see @ab.ts", [aTs])).toStrictEqual([]);
	});

	it("keeps a range when text is inserted exactly at its end", () => {
		expect(remapMentions("see @a.ts", "see @a.tsx", [aTs])).toStrictEqual([aTs]);
	});

	it("shifts a range when text is inserted exactly at its start", () => {
		expect(remapMentions("see @a.ts", "see x@a.ts", [aTs])).toStrictEqual([
			{start: 5, end: 10, relPath: "a.ts", isDirectory: false},
		]);
	});

	it("drops a range the edit fully covers", () => {
		expect(remapMentions("see @a.ts x", "see  x", [aTs])).toStrictEqual([]);
	});

	it("drops a range a replacement overlaps from the left", () => {
		expect(remapMentions("see @a.ts", "sZZa.ts", [aTs])).toStrictEqual([]);
	});

	it("returns the ranges unchanged when the text is unchanged", () => {
		expect(remapMentions("see @a.ts", "see @a.ts", [aTs])).toStrictEqual([aTs]);
	});

	it("remaps each of several ranges independently", () => {
		const bTs: AcceptedMention = {start: 10, end: 15, relPath: "b.ts", isDirectory: false};
		expect(remapMentions("see @a.ts @b.ts", "see @a.ts and @b.ts", [aTs, bTs])).toStrictEqual([
			aTs,
			{start: 14, end: 19, relPath: "b.ts", isDirectory: false},
		]);
	});
});

describe("mention lookups", () => {
	const src: AcceptedMention = {start: 0, end: 3, relPath: "s/", isDirectory: true};
	const mentions = [src, aTs];

	it("mentionAt returns the range strictly containing the caret", () => {
		expect([
			mentionAt(mentions, 0),
			mentionAt(mentions, 2),
			mentionAt(mentions, 3),
			mentionAt(mentions, 6),
		]).toStrictEqual([undefined, src, undefined, aTs]);
	});

	it("mentionEndingAt returns the range whose end is the caret", () => {
		expect([
			mentionEndingAt(mentions, 3),
			mentionEndingAt(mentions, 9),
			mentionEndingAt(mentions, 4),
		]).toStrictEqual([src, aTs, undefined]);
	});

	it("mentionStartingAt returns the range whose start is the caret", () => {
		expect([
			mentionStartingAt(mentions, 0),
			mentionStartingAt(mentions, 4),
			mentionStartingAt(mentions, 3),
		]).toStrictEqual([src, aTs, undefined]);
	});
});
