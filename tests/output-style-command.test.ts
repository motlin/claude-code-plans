import {describe, expect, it} from "vite-plus/test";

import {isMcpCommand, isMemoryCommand, parseOutputStyleCommand} from "../src/lib/composer-host-commands";
import type {OutputStyleItem} from "../src/lib/output-style-options";

const ITEMS: OutputStyleItem[] = [
	{
		name: "default",
		label: "Default",
		checked: true,
	},
	{
		name: "Explanatory",
		label: "Explanatory",
		checked: false,
	},
	{
		name: "Learning",
		label: "Learning",
		checked: false,
	},
];

const LIVE =
{
	hasSession: true,
	booting: false,
};

describe("parseOutputStyleCommand", () =>
{
	it("routes each form the way upstream's submit handler does", () =>
	{
		const cases: [string, OutputStyleItem[] | undefined, typeof LIVE][] = [
			["/output-style", ITEMS, LIVE],
			["  /output-style  ", ITEMS, LIVE],
			["/output-style Learning", ITEMS, LIVE],
			["/output-style:Learning", ITEMS, LIVE],
			["/OUTPUT-STYLE  explanatory", ITEMS, LIVE],
			["/output-style default", ITEMS, LIVE],
			["/output-style zzz", ITEMS, LIVE],
			[
				"/output-style",
				ITEMS,
				{
					hasSession: false,
					booting: false,
				},
			],
			[
				"/output-style Learning",
				undefined,
				{
					hasSession: true,
					booting: true,
				},
			],
			["/output-style", undefined, LIVE],
			["/output-styles", ITEMS, LIVE],
			["/model", ITEMS, LIVE],
		];
		expect(cases.map(([text, items, ctx]) => parseOutputStyleCommand(text, items, ctx))).toStrictEqual([
			{
				kind: "open",
			},
			{
				kind: "open",
			},
			{
				kind: "send",
				text: "/output-style Learning",
			},
			{
				kind: "send",
				text: "/output-style Learning",
			},
			{
				kind: "send",
				text: "/output-style Explanatory",
			},
			{
				kind: "already",
				message: "Output style already set to Default.",
			},
			{
				kind: "refuse",
				message: "“zzz” isn’t an available output style.",
			},
			{
				kind: "home",
				message: "Set the output style in settings. This session uses it when it starts.",
			},
			{
				kind: "refuse",
				message: "Output styles haven’t loaded yet. Try again in a moment.",
			},
			{
				kind: "refuse",
				message: "Output styles aren’t available for this session.",
			},
			null,
			null,
		]);
	});

	it("matches a style by its label when no name matches", () =>
	{
		expect(
			parseOutputStyleCommand(
				"/output-style plain",
				[
					{
						name: "plugin:plain",
						label: "Plain",
						checked: false,
					},
				],
				LIVE,
			),
		).toStrictEqual(
			{
				kind: "send",
				text: "/output-style plugin:plain",
			},
		);
	});
});

describe("isMemoryCommand and isMcpCommand", () =>
{
	it("take /memory with or without arguments, and only an exact /mcp", () =>
	{
		expect(
			["/memory", " /MEMORY foo ", "/memoryx", "/mcp", " /mcp ", "/mcp list", "/MCP"].map((text) => [
				isMemoryCommand(text),
				isMcpCommand(text),
			]),
		).toStrictEqual([
			[true, false],
			[true, false],
			[false, false],
			[false, true],
			[false, true],
			[false, false],
			[false, false],
		]);
	});
});
