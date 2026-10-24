import {describe, expect, it} from "vite-plus/test";
import {
	buildLaunchFlags,
	CLI_DEFAULT_MODEL,
	fastModeSupported,
	MORE_MODELS,
	modelMenuValue,
	moreModelsMenuValue,
	primaryModelMenuValue,
	resolveLaunchModel,
	withModel,
} from "../src/lib/launch-options";

describe("modelMenuValue", () => {
	it.each([
		{id: "claude-fable-5-1", expected: "fable"},
		{id: "claude-opus-4-8[1m]", expected: "claude-opus-4-8"},
		{id: "claude-haiku-4-5-20251001", expected: "claude-haiku-4-5-20251001"},
		{id: "claude-haiku-4-2", expected: "haiku"},
		{id: "sonnet", expected: "sonnet"},
		{id: "claude-opus-4-6", expected: "claude-opus-4-6"},
		{id: "claude-sonnet-3-7-20250219", expected: "sonnet"},
		{id: "gpt-unknown", expected: null},
		{id: null, expected: null},
	])("$id -> $expected", ({id, expected}) => {
		expect(modelMenuValue(id)).toStrictEqual(expected);
	});
});

describe("MORE_MODELS", () => {
	it("starts with Haiku 4.5, as upstream's More models does", () => {
		expect(MORE_MODELS[0]).toStrictEqual({id: "claude-haiku-4-5-20251001", label: "Haiku 4.5"});
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

describe("buildLaunchFlags effort", () => {
	it("launches Ultracode with the CLI's --effort ultracode", () => {
		expect(buildLaunchFlags({effort: "ultracode"})).toStrictEqual(["--effort", "ultracode"]);
	});
});

describe("buildLaunchFlags worktree", () => {
	it("passes a valueless --worktree", () => {
		expect(buildLaunchFlags({worktree: true})).toStrictEqual(["--worktree"]);
	});

	it("puts --worktree last so its optional name never swallows another flag's value", () => {
		expect(buildLaunchFlags({worktree: true, permissionMode: "plan", model: "opus", effort: "high"})).toStrictEqual(
			["--permission-mode", "plan", "--model", "opus", "--effort", "high", "--worktree"],
		);
	});
});

describe("fastModeSupported", () => {
	it.each([
		{model: "opus", expected: true},
		{model: "opus[1m]", expected: true},
		{model: "claude-opus-5-5", expected: true},
		{model: "claude-opus-5", expected: true},
		{model: "claude-opus-4-8[1m]", expected: true},
		{model: "claude-opus-4-6", expected: true},
		{model: "claude-opus-4-7", expected: false},
		{model: "sonnet", expected: false},
		{model: "claude-fable-5-1", expected: false},
		{model: "haiku", expected: false},
	])("$model -> $expected", ({model, expected}) => {
		expect(fastModeSupported(model)).toBe(expected);
	});
});

describe("buildLaunchFlags fast mode", () => {
	it("launches fast mode through one --settings JSON", () => {
		expect({
			on: buildLaunchFlags({fastMode: true}),
			off: buildLaunchFlags({fastMode: false}),
			withEverything: buildLaunchFlags({
				worktree: true,
				permissionMode: "plan",
				model: "opus",
				effort: "ultracode",
				fastMode: true,
			}),
		}).toStrictEqual({
			on: ["--settings", '{"fastMode":true}'],
			off: [],
			withEverything: [
				"--permission-mode",
				"plan",
				"--model",
				"opus",
				"--effort",
				"ultracode",
				"--settings",
				'{"fastMode":true}',
				"--worktree",
			],
		});
	});
});

describe("withModel", () => {
	it("drops fast mode when the picked model doesn't offer it, since the CLI turns it off", () => {
		expect({
			sonnet: withModel({effort: "high", fastMode: true}, "sonnet"),
			opus: withModel({effort: "high", fastMode: true}, "claude-opus-4-6"),
			off: withModel({fastMode: false}, "fable"),
		}).toStrictEqual({
			sonnet: {effort: "high", model: "sonnet"},
			opus: {effort: "high", fastMode: true, model: "claude-opus-4-6"},
			off: {model: "fable"},
		});
	});
});
