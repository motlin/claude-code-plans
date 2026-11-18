import {describe, expect, it} from "vite-plus/test";

import {MORE_MODELS, PRIMARY_MODELS, modelLabel, modelRowsFor} from "../src/lib/launch-options";
import {retryModelItems} from "../src/lib/retry-model-items";

const RESTRICTION = "Not in availableModels set by your Claude Code settings (~/.claude/settings.json)";

function rows(models: typeof PRIMARY_MODELS, checked: string)
{
	return models.map((model) => (
	{
		value: model.id,
		label: model.label,
		checked: model.id === checked,
	}));
}

describe("retryModelItems", () =>
{
	it("checks the primary alias a latest full id launches, with More models unchecked and no pinned row", () =>
	{
		expect(
			retryModelItems(
				{
					current: "claude-opus-5-5",
				},
			),
		).toStrictEqual(
			{
				main: rows(PRIMARY_MODELS, "opus"),
				more: rows(MORE_MODELS, ""),
			},
		);
	});

	it("checks an overflow model inside More models", () =>
	{
		const items = retryModelItems(
			{
				current: "claude-opus-4-6",
			},
		);

		expect(
			{
				main: items.main,
				checked: items.more.filter((item) => item.checked),
				pinned: items.pinned,
			},
		).toStrictEqual(
			{
				main: rows(PRIMARY_MODELS, ""),
				checked: [
					{
						value: "claude-opus-4-6",
						label: "Opus 4.6",
						checked: true,
					},
				],
				pinned: undefined,
			},
		);
	});

	it("pins an off-catalog model first as a checked, enabled row with its formatted id", () =>
	{
		const items = retryModelItems(
			{
				current: "claude-3-7-sonnet-20250219",
			},
		);

		expect(items).toStrictEqual(
			{
				pinned:
				{
					value: "claude-3-7-sonnet-20250219",
					label: modelLabel("claude-3-7-sonnet-20250219"),
					checked: true,
				},
				main: rows(PRIMARY_MODELS, ""),
				more: rows(MORE_MODELS, ""),
			},
		);
	});

	it("checks a [1m] id's twin when the rows list it, and its base row when they don't", () =>
	{
		const catalog = modelRowsFor(
			{
				settingsModel: "opus[1m]",
				availableModels: undefined,
			},
		);

		expect(
			{
				twin: retryModelItems(
					{
						current: "claude-opus-5-5[1m]",
						catalog,
					},
				).main.filter((item) => item.checked),
				base: retryModelItems(
					{
						current: "claude-opus-4-6[1m]",
					},
				).more.filter((item) => item.checked),
			},
		).toStrictEqual(
			{
				twin: [
					{
						value: "opus[1m]",
						label: "Opus 5.5 1M",
						checked: true,
					},
				],
				base: [
					{
						value: "claude-opus-4-6",
						label: "Opus 4.6",
						checked: true,
					},
				],
			},
		);
	});

	it("checks nothing and pins nothing with no running model", () =>
	{
		expect(
			retryModelItems(
				{
					current: undefined,
				},
			),
		).toStrictEqual(
			{
				main: rows(PRIMARY_MODELS, ""),
				more: rows(MORE_MODELS, ""),
			},
		);
	});

	it("badges the settings model's row Default, or Set by admin when managed", () =>
	{
		const badged = (managed: boolean) =>
			retryModelItems(
				{
					current: "claude-sonnet-5-5",
					defaultModel:
					{
						value: "opus",
						managed,
					},
				},
			).main.filter((item) => item.badge !== undefined);

		expect(
			{
				user: badged(false),
				managed: badged(true),
			},
		).toStrictEqual(
			{
				user: [
					{
						value: "opus",
						label: "Opus 5.5",
						checked: false,
						badge: "Default",
					},
				],
				managed: [
					{
						value: "opus",
						label: "Opus 5.5",
						checked: false,
						badge: "Set by admin",
					},
				],
			},
		);
	});

	it("badges the pinned row when it runs the settings model", () =>
	{
		expect(
			retryModelItems(
				{
					current: "claude-custom-1",
					defaultModel:
					{
						value: "claude-custom-1",
						managed: false,
					},
				},
			).pinned,
		).toStrictEqual(
			{
				value: "claude-custom-1",
				label: modelLabel("claude-custom-1"),
				checked: true,
				badge: "Default",
			},
		);
	});

	it("disables an allowlist-restricted row with the Unavailable suffix and its reason, but never the current row", () =>
	{
		const restrictionFor = (id: string) => (id === "haiku" || id === "opus" ? RESTRICTION : undefined);
		const items = retryModelItems(
			{
				current: "claude-opus-5-5",
				restrictionFor,
			},
		);

		expect(items.main.filter((item) => item.value === "haiku" || item.value === "opus")).toStrictEqual([
			{
				value: "opus",
				label: "Opus 5.5",
				checked: true,
			},
			{
				value: "haiku",
				label: "Haiku 5.5",
				checked: false,
				disabled: true,
				suffix: "Unavailable",
				description: RESTRICTION,
			},
		]);
	});

	it("pins a deprecated current model as a disabled Unavailable row with upstream's Legacy description", () =>
	{
		expect(
			retryModelItems(
				{
					current: "claude-opus-4-1-20250805",
					isDeprecated: (id) => id.startsWith("claude-opus-4-1"),
				},
			).pinned,
		).toStrictEqual(
			{
				value: "claude-opus-4-1-20250805",
				label: modelLabel("claude-opus-4-1-20250805"),
				checked: true,
				disabled: true,
				suffix: "Unavailable",
				description: "Previous-generation model. May be removed in a future update.",
			},
		);
	});
});
