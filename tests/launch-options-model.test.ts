import {describe, expect, it} from "vite-plus/test";
import {
	buildLaunchFlags,
	CLI_DEFAULT_MODEL,
	defaultEffortFor,
	EFFORT_LEVELS,
	effortLevelsFor,
	type EffortOption,
	effortOptionsFor,
	MAX_EFFORT_GENERIC_TOOLTIP,
	MAX_EFFORT_TOOLTIP,
	fastModeSupported,
	MORE_MODELS,
	modelLabel,
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

describe("buildLaunchFlags ultracode", () => {
	it("arms Ultracode through the CLI's per-session `ultracode` settings key, beside any effort", () => {
		expect({
			high: buildLaunchFlags({effort: "high", ultracode: true}),
			off: buildLaunchFlags({effort: "high", ultracode: false}),
			fast: buildLaunchFlags({fastMode: true, ultracode: true}),
		}).toStrictEqual({
			high: ["--effort", "high", "--settings", '{"ultracode":true}'],
			off: ["--effort", "high"],
			fast: ["--settings", '{"fastMode":true,"ultracode":true}'],
		});
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

describe("effortLevelsFor", () => {
	it.each([
		{model: "claude-haiku-4-5-20251001", expected: []},
		{model: "claude-haiku-4-5", expected: []},
		{model: "claude-haiku-4-5-20251001[1m]", expected: []},
		{model: "opus", expected: ["low", "medium", "high", "xhigh", "max"]},
		{model: "default", expected: EFFORT_LEVELS},
		{model: "haiku", expected: EFFORT_LEVELS},
		{model: "claude-sonnet-4-6", expected: ["low", "medium", "high", "max"]},
	])("$model -> $expected", ({model, expected}) => {
		expect(effortLevelsFor(model)).toStrictEqual(expected);
	});
});

describe("modelLabel", () => {
	it("labels the CLI's default alias with the model it launches", () => {
		expect({def: modelLabel("default"), opus: modelLabel("opus")}).toStrictEqual({
			def: "Opus 5.5",
			opus: "Opus 5.5",
		});
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
				effort: "max",
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
				"max",
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

	it("drops an effort the picked model doesn't offer, as upstream switches to that model's own effort", () => {
		expect({
			xhigh: withModel({effort: "xhigh", fastMode: true}, "claude-opus-4-6"),
			max: withModel({effort: "max"}, "claude-opus-4-6"),
			haiku: withModel({effort: "high"}, "claude-haiku-4-5-20251001"),
		}).toStrictEqual({
			xhigh: {model: "claude-opus-4-6", fastMode: true},
			max: {effort: "max", model: "claude-opus-4-6"},
			haiku: {model: "claude-haiku-4-5-20251001"},
		});
	});
});

function options(recommended: string, maxTooltip: string, levels = ["low", "medium", "high", "xhigh", "max"]) {
	return levels.map((id): EffortOption => {
		if (id !== "max")
			return {
				id: EFFORT_LEVELS.find((level) => level === id)!,
				recommended: id === recommended,
				maxWarning: false,
			};
		return {id: "max", recommended: false, maxWarning: maxTooltip === MAX_EFFORT_TOOLTIP, tooltip: maxTooltip};
	});
}

describe("effortOptionsFor", () => {
	it.each([
		{model: "opus", expected: options("medium", MAX_EFFORT_TOOLTIP)},
		{model: "claude-opus-5-5", expected: options("medium", MAX_EFFORT_TOOLTIP)},
		{model: "default", expected: options("medium", MAX_EFFORT_TOOLTIP)},
		{model: "fable", expected: options("high", MAX_EFFORT_GENERIC_TOOLTIP)},
		{model: "sonnet", expected: options("medium", MAX_EFFORT_GENERIC_TOOLTIP)},
		{model: "haiku", expected: options("medium", MAX_EFFORT_GENERIC_TOOLTIP)},
		{model: "claude-sonnet-5", expected: options("high", MAX_EFFORT_GENERIC_TOOLTIP)},
		{model: "claude-opus-5", expected: options("high", MAX_EFFORT_GENERIC_TOOLTIP)},
		{model: "claude-fable-5", expected: options("high", MAX_EFFORT_GENERIC_TOOLTIP)},
		{model: "claude-opus-4-8", expected: options("high", MAX_EFFORT_GENERIC_TOOLTIP)},
		{model: "claude-opus-4-7", expected: options("xhigh", MAX_EFFORT_GENERIC_TOOLTIP)},
		{
			model: "claude-opus-4-6",
			expected: options("high", MAX_EFFORT_GENERIC_TOOLTIP, ["low", "medium", "high", "max"]),
		},
		{
			model: "claude-opus-4-6[1m]",
			expected: options("high", MAX_EFFORT_GENERIC_TOOLTIP, ["low", "medium", "high", "max"]),
		},
		{
			model: "claude-sonnet-4-6",
			expected: options("high", MAX_EFFORT_GENERIC_TOOLTIP, ["low", "medium", "high", "max"]),
		},
		{model: "claude-haiku-4-5-20251001", expected: []},
		{model: "claude-foo-9", expected: options("medium", MAX_EFFORT_GENERIC_TOOLTIP)},
	])("$model", ({model, expected}) => {
		expect(effortOptionsFor(model)).toStrictEqual(expected);
	});

	it("words the two Max tooltips as upstream's live catalog does", () => {
		expect({warning: MAX_EFFORT_TOOLTIP, generic: MAX_EFFORT_GENERIC_TOOLTIP}).toStrictEqual({
			warning: "Claude thinks longer with Max effort and can consume 3.5× or more usage than Medium.",
			generic:
				"May use excessive tokens resulting in long response times and may hit token limits. Use sparingly for the hardest tasks.",
		});
	});
});

describe("defaultEffortFor", () => {
	it.each([
		{model: "claude-opus-5-5", expected: "medium"},
		{model: "claude-opus-4-7", expected: "xhigh"},
		{model: "claude-fable-5-1", expected: "high"},
		{model: "claude-haiku-4-5-20251001", expected: null},
	])("$model -> $expected", ({model, expected}) => {
		expect(defaultEffortFor(model)).toBe(expected);
	});
});
