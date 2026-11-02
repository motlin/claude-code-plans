import {describe, expect, it} from "vite-plus/test";
import {capDetails, parseHookMessage} from "../src/lib/hook-prompt-block";

describe("parseHookMessage", () =>
{
	it("splits the CLI's block record into label, reason and original prompt", () =>
	{
		const content =
			"UserPromptSubmit operation blocked by hook:\n[cmd]: worker unreachable\n\n\nOriginal prompt: what's next?";
		expect(parseHookMessage(content)).toStrictEqual(
			{
				kind: "blocked",
				label: "UserPromptSubmit operation blocked by hook",
				reason: "[cmd]: worker unreachable",
				originalPrompt: "what's next?",
			},
		);
	});

	it("keeps the original prompt untrimmed", () =>
	{
		expect(
			parseHookMessage("UserPromptSubmit operation blocked by hook: no\n\nOriginal prompt:  hi \n"),
		).toStrictEqual(
			{
				kind: "blocked",
				label: "UserPromptSubmit operation blocked by hook",
				reason: "no",
				originalPrompt: " hi \n",
			},
		);
	});

	it("gives no originalPrompt key without the separator", () =>
	{
		expect(parseHookMessage("UserPromptSubmit operation blocked by hook:\nnope\n")).toStrictEqual(
			{
				kind: "blocked",
				label: "UserPromptSubmit operation blocked by hook",
				reason: "nope",
			},
		);
	});

	it("gives an empty reason when the hook said nothing", () =>
	{
		expect(parseHookMessage("UserPromptSubmit operation blocked by hook:\n\n\nOriginal prompt: x")).toStrictEqual(
			{
				kind: "blocked",
				label: "UserPromptSubmit operation blocked by hook",
				reason: "",
				originalPrompt: "x",
			},
		);
	});

	it("reads the UserPromptExpansion label", () =>
	{
		expect(parseHookMessage("UserPromptExpansion operation blocked by hook: busy")).toStrictEqual(
			{
				kind: "blocked",
				label: "UserPromptExpansion operation blocked by hook",
				reason: "busy",
			},
		);
	});

	it("reads a stopped message", () =>
	{
		expect(parseHookMessage("Operation stopped by hook: nope")).toStrictEqual(
			{
				kind: "stopped",
				label: "Operation stopped by hook",
				reason: "nope",
			},
		);
	});

	it("gives null for any other text", () =>
	{
		expect(parseHookMessage("hello")).toBeNull();
	});
});

describe("capDetails", () =>
{
	it("cuts text past 262144 chars and adds an ellipsis", () =>
	{
		const capped = capDetails("a".repeat(262145));
		expect(capped).toStrictEqual(`${"a".repeat(262144)}…`);
	});

	it("leaves text at the cap alone", () =>
	{
		const text = "a".repeat(262144);
		expect(capDetails(text)).toStrictEqual(text);
	});
});
