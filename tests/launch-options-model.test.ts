import {describe, expect, it} from "vite-plus/test";
import {
	CLI_DEFAULT_MODEL,
	modelMenuValue,
	moreModelsMenuValue,
	primaryModelMenuValue,
	resolveLaunchModel,
} from "../src/lib/launch-options";

describe("modelMenuValue", () => {
	it.each([
		{id: "claude-fable-5-1", expected: "fable"},
		{id: "claude-opus-4-8[1m]", expected: "claude-opus-4-8"},
		{id: "claude-haiku-4-5-20251001", expected: "haiku"},
		{id: "sonnet", expected: "sonnet"},
		{id: "claude-opus-4-6", expected: "claude-opus-4-6"},
		{id: "claude-sonnet-3-7-20250219", expected: "sonnet"},
		{id: "gpt-unknown", expected: null},
		{id: null, expected: null},
	])("$id -> $expected", ({id, expected}) => {
		expect(modelMenuValue(id)).toStrictEqual(expected);
	});
});

describe("primary and More models values", () => {
	it.each([
		{current: "fable", primary: "fable", more: "claude-fable-5-1"},
		{current: "claude-fable-5-1", primary: "fable", more: "claude-fable-5-1"},
		{current: "claude-opus-4-8", primary: "", more: "claude-opus-4-8"},
		{current: undefined, primary: "", more: ""},
	])("$current", ({current, primary, more}) => {
		expect({primary: primaryModelMenuValue(current), more: moreModelsMenuValue(current)}).toStrictEqual({
			primary,
			more,
		});
	});
});

describe("resolveLaunchModel", () => {
	it.each([
		{settings: null, expected: CLI_DEFAULT_MODEL},
		{settings: "", expected: CLI_DEFAULT_MODEL},
		{settings: "default", expected: CLI_DEFAULT_MODEL},
		{settings: "sonnet", expected: "claude-sonnet-5-5"},
		{settings: "claude-opus-4-8[1m]", expected: "claude-opus-4-8[1m]"},
	])("$settings -> $expected", ({settings, expected}) => {
		expect(resolveLaunchModel(settings)).toStrictEqual(expected);
	});

	it("defaults to Opus 5.5 like the CLI", () => {
		expect(CLI_DEFAULT_MODEL).toBe("claude-opus-5-5");
	});
});
