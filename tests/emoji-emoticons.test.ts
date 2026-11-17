import {describe, expect, it} from "vite-plus/test";
import {EMOTICON_RULE, EMOTICONS, matchEmoticon} from "../src/lib/emoji-emoticons";

describe("emoticon auto-replace", () =>
{
	it("copies upstream's 32 emoticons", () =>
	{
		expect(EMOTICONS).toEqual(
			{
				"<3": "❤️",
				"</3": "\u{1F494}",
				":)": "\u{1F642}",
				":-)": "\u{1F642}",
				":(": "\u{1F61E}",
				":-(": "\u{1F61E}",
				":'(": "\u{1F622}",
				">:(": "\u{1F620}",
				":D": "\u{1F603}",
				":-D": "\u{1F603}",
				":/": "\u{1F615}",
				":-/": "\u{1F615}",
				":\\": "\u{1F615}",
				":-\\": "\u{1F615}",
				":|": "\u{1F610}",
				":-|": "\u{1F610}",
				":*": "\u{1F618}",
				":-*": "\u{1F618}",
				":o": "\u{1F62E}",
				":O": "\u{1F62E}",
				":-o": "\u{1F62E}",
				":-O": "\u{1F62E}",
				":p": "\u{1F61B}",
				":P": "\u{1F61B}",
				":-p": "\u{1F61B}",
				":-P": "\u{1F61B}",
				";)": "\u{1F609}",
				";-)": "\u{1F609}",
				";p": "\u{1F61C}",
				";P": "\u{1F61C}",
				";-p": "\u{1F61C}",
				";-P": "\u{1F61C}",
			},
		);
		expect(Object.keys(EMOTICONS).length).toBe(32);
	});

	it("builds the rule longest-first like upstream", () =>
	{
		expect(EMOTICON_RULE.source).toBe(
			String.raw`(^|\s)(<\/3|:-\)|:-\(|:'\(|>:\(|:-D|:-\/|:-\\|:-\||:-\*|:-o|:-O|:-p|:-P|;-\)|;-p|;-P|<3|:\)|:\(|:D|:\/|:\\|:\||:\*|:o|:O|:p|:P|;\)|;p|;P) $`,
		);
	});

	it("matches an emoticon at the line start or after whitespace, followed by the typed space", () =>
	{
		expect(matchEmoticon(":) ")).toEqual(
			{
				start: 0,
				end: 3,
				emoji: "\u{1F642}",
			},
		);
		expect(matchEmoticon("a\t:'( ")).toEqual(
			{
				start: 2,
				end: 6,
				emoji: "\u{1F622}",
			},
		);
		expect(matchEmoticon("x >:( ")).toEqual(
			{
				start: 2,
				end: 6,
				emoji: "\u{1F620}",
			},
		);
		expect(matchEmoticon("a :o ")).toEqual(
			{
				start: 2,
				end: 5,
				emoji: "\u{1F62E}",
			},
		);
	});

	it("leaves glued, unknown, extended and unspaced emoticons alone", () =>
	{
		expect([
			matchEmoticon("hi:) "),
			matchEmoticon(":X "),
			matchEmoticon("x :)) "),
			matchEmoticon("(:) "),
			matchEmoticon("a :)"),
		]).toEqual([null, null, null, null, null]);
	});
});
