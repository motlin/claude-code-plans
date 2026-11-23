import {describe, expect, it} from "vite-plus/test";
import
{
	autocompactCommand,
	extraLinesBody,
	fastCommandArg,
	type HostCommandContext,
	parseCommandShape,
	parseHostCommand,
	parseSignInCommand,
	planCommandArg,
	routeFastCommand,
	routePlanCommand,
	routeSkillsCommand,
	routeStatusCommand,
	routeUsageCommand,
	skillsCommandAction,
	SIGN_IN_COMMAND_KEY,
	signInCommandToast,
	SLASH_NAME,
	trailingArgsBody,
} from "../src/lib/composer-host-commands";
import {EFFORT_LEVELS, effortLevelsFor, MORE_MODELS, PRIMARY_MODELS} from "../src/lib/launch-options";

const ctx: HostCommandContext =
{
	effortLevels: EFFORT_LEVELS,
	models: [...PRIMARY_MODELS, ...MORE_MODELS].map((model) => model.id),
	menusAvailable: true,
};
const locked: HostCommandContext =
{
	...ctx,
	menusAvailable: false,
};

describe("parseHostCommand", () =>
{
	it.each([
		[
			"/model",
			{
				kind: "open",
				menu: "model",
				name: "model",
			},
		],
		[
			"  /MODEL  ",
			{
				kind: "open",
				menu: "model",
				name: "model",
			},
		],
		[
			"/effort",
			{
				kind: "open",
				menu: "effort",
				name: "effort",
			},
		],
		[
			"/permissions",
			{
				kind: "open",
				menu: "mode",
				name: "permissions",
			},
		],
		[
			"/allowed-tools",
			{
				kind: "open",
				menu: "mode",
				name: "allowed-tools",
			},
		],
		[
			"/effort high",
			{
				kind: "effort",
				level: "high",
				name: "effort",
			},
		],
		[
			"/effort HIGH",
			{
				kind: "effort",
				level: "high",
				name: "effort",
			},
		],
		[
			"/model opus",
			{
				kind: "model",
				model: "opus",
				name: "model",
			},
		],
		[
			"/model:opus",
			{
				kind: "model",
				model: "opus",
				name: "model",
			},
		],
		[
			"/model, opus",
			{
				kind: "model",
				model: "opus",
				name: "model",
			},
		],
		[
			"/model.opus",
			{
				kind: "model",
				model: "opus",
				name: "model",
			},
		],
		[
			"/model OPUS",
			{
				kind: "model",
				model: "opus",
				name: "model",
			},
		],
		[
			"/model claude-opus-4-6",
			{
				kind: "model",
				model: "claude-opus-4-6",
				name: "model",
			},
		],
		[
			"/model default",
			{
				kind: "model",
				model: "default",
				name: "model",
			},
		],
		[
			"/model DEFAULT",
			{
				kind: "model",
				model: "default",
				name: "model",
			},
		],
		[
			"/model best",
			{
				kind: "model",
				model: "best",
				name: "model",
			},
		],
		[
			"/model opusplan",
			{
				kind: "model",
				model: "opusplan",
				name: "model",
			},
		],
		[
			"/model mythos",
			{
				kind: "model",
				model: "mythos",
				name: "model",
			},
		],
		[
			"/model claude-opus-4-6-20260101",
			{
				kind: "model",
				model: "claude-opus-4-6",
				name: "model",
			},
		],
		[
			"/model claude-opus-4-6-20260101[1m]",
			{
				kind: "model",
				model: "claude-opus-4-6",
				name: "model",
			},
		],
		[
			"/model claude-haiku-4-5-20251001",
			{
				kind: "model",
				model: "claude-haiku-4-5-20251001",
				name: "model",
			},
		],
	])("%j opens or applies", (text, expected) =>
	{
		expect(parseHostCommand(text, ctx)).toStrictEqual(expected);
	});

	it.each([
		[
			"/model gpt5",
			{
				kind: "refuse",
				toast: "“gpt5” isn’t an available model.",
			},
		],
		[
			"/permissions plan",
			{
				kind: "band",
				text: "/permissions doesn’t take arguments here. Remove the text after the command, then send it again.",
			},
		],
		[
			"/permissions\nx",
			{
				kind: "band",
				text: "/permissions only works on a single line. Remove the extra lines, then send it again.",
			},
		],
	])("%j refuses with copy", (text, expected) =>
	{
		expect(parseHostCommand(text, ctx)).toStrictEqual(expected);
	});

	it.each([
		[
			"/model",
			{
				kind: "refuse",
				toast: "Model can’t be changed for this session right now.",
			},
		],
		[
			"/model opus",
			{
				kind: "refuse",
				toast: "Model can’t be changed for this session right now.",
			},
		],
		[
			"/effort",
			{
				kind: "refuse",
				toast: "The model is still loading. Try /effort again in a moment.",
			},
		],
		[
			"/effort high",
			{
				kind: "refuse",
				toast: "The model is still loading. Try /effort again in a moment.",
			},
		],
		[
			"/permissions",
			{
				kind: "refuse",
				toast: "The permission mode can’t be changed for this session.",
			},
		],
		[
			"/allowed-tools",
			{
				kind: "refuse",
				toast: "The permission mode can’t be changed for this session.",
			},
		],
	])("%j refuses while menus are unavailable", (text, expected) =>
	{
		expect(parseHostCommand(text, locked)).toStrictEqual(expected);
	});

	it.each(["/effort foo", "/modelx", "/btw hi", "hello /model", "", "/", "/compact"])(
		"%j is sent as typed",
		(text) =>
		{
			expect(parseHostCommand(text, ctx)).toBeNull();
		},
	);

	it("sends /effort xhigh as typed on a model whose catalog has no Extra, as an unknown level is", () =>
	{
		expect(
			parseHostCommand(
				"/effort xhigh",
				{
					...ctx,
					effortLevels: effortLevelsFor("claude-sonnet-4-6"),
				},
			),
		).toBeNull();
	});

	it("leaves /effort ultracode to the CLI, whose /effort toggles it", () =>
	{
		expect(parseHostCommand("/effort ultracode", ctx)).toBeNull();
	});

	it("leaves /effort to the CLI when the model has no effort levels", () =>
	{
		expect(
			parseHostCommand(
				"/effort",
				{
					...ctx,
					effortLevels: [],
				},
			),
		).toBeNull();
	});

	it("opens the Model menu for /effort when the model offers at most one level", () =>
	{
		expect(
			parseHostCommand(
				"/effort",
				{
					...ctx,
					effortLevels: ["high"],
				},
			),
		).toStrictEqual(
			{
				kind: "open",
				menu: "model",
				name: "effort",
			},
		);
	});
});

describe("routeFastCommand", () =>
{
	it.each([
		[
			{
				arg: "on",
				on: true,
				canToggle: true,
			},
			"noop",
		],
		[
			{
				arg: "off",
				on: false,
				canToggle: true,
			},
			"noop",
		],
		[
			{
				arg: "OFF",
				on: false,
				canToggle: true,
			},
			"noop",
		],
		[
			{
				arg: "",
				on: false,
				canToggle: true,
			},
			"toggle",
		],
		[
			{
				arg: "",
				on: true,
				canToggle: true,
			},
			"toggle",
		],
		[
			{
				arg: "on",
				on: false,
				canToggle: true,
			},
			"toggle",
		],
		[
			{
				arg: "off",
				on: true,
				canToggle: true,
			},
			"toggle",
		],
		[
			{
				arg: "turbo",
				on: false,
				canToggle: true,
			},
			"unhandled",
		],
		[
			{
				arg: "",
				on: false,
				canToggle: false,
			},
			"unhandled",
		],
		[
			{
				arg: "on",
				on: false,
				canToggle: false,
			},
			"unhandled",
		],
	] as const)("%j routes to %s", (input, expected) =>
	{
		expect(routeFastCommand(input)).toBe(expected);
	});
});

describe("fastCommandArg", () =>
{
	it.each([
		["/fast", ""],
		["  /fast  ", ""],
		["/fast on", "on"],
		["/FAST  Off ", "Off"],
		["/fast turbo mode", "turbo mode"],
		["/faster", null],
		["/model", null],
		["hello /fast", null],
	])("%j has arg %j", (text, expected) =>
	{
		expect(fastCommandArg(text)).toBe(expected);
	});
});

describe("parseCommandShape", () =>
{
	const names = ["permissions", "allowed-tools"];

	it.each([
		[
			"/permissions",
			{
				kind: "run",
				name: "permissions",
			},
		],
		[
			"  /permissions  ",
			{
				kind: "run",
				name: "permissions",
			},
		],
		[
			"/permissions plan",
			{
				kind: "trailing_args",
				name: "permissions",
			},
		],
		[
			"/permissions\nx",
			{
				kind: "extra_lines",
				name: "permissions",
			},
		],
		[
			"/permissions\rx",
			{
				kind: "extra_lines",
				name: "permissions",
			},
		],
		[
			"/permissions plan\nx",
			{
				kind: "extra_lines",
				name: "permissions",
			},
		],
		[
			"/PERMISSIONS",
			{
				kind: "run",
				name: "permissions",
			},
		],
		[
			"/Allowed-Tools x",
			{
				kind: "trailing_args",
				name: "allowed-tools",
			},
		],
	])("%j", (text, expected) =>
	{
		expect(parseCommandShape(names, text)).toStrictEqual(expected);
	});

	it.each(["/permissionsx", "permissions", "/status", "x /permissions"])("%j is not one of the names", (text) =>
	{
		expect(parseCommandShape(names, text)).toBeNull();
	});
});

describe("band bodies", () =>
{
	it("match upstream's literal strings", () =>
	{
		expect([trailingArgsBody("permissions"), extraLinesBody("permissions")]).toStrictEqual([
			"/permissions doesn\u2019t take arguments here. Remove the text after the command, then send it again.",
			"/permissions only works on a single line. Remove the extra lines, then send it again.",
		]);
	});
});

describe("autocompactCommand", () =>
{
	it("opens on a bare /autocompact (any case, surrounding spaces) and lets an argument reach the CLI", () =>
	{
		const inputs = [
			"/autocompact",
			"/AutoCompact",
			"  /autocompact   ",
			"/autocompact 50000",
			"/autocompact auto",
			"/autocompactx",
			"/autocompact\nmore",
			"/context",
		];

		expect(Object.fromEntries(inputs.map((input) => [input, autocompactCommand(input)]))).toStrictEqual(
			{
				"/autocompact": "open",
				"/AutoCompact": "open",
				"  /autocompact   ": "open",
				"/autocompact 50000": null,
				"/autocompact auto": null,
				"/autocompactx": null,
				"/autocompact\nmore": null,
				"/context": null,
			},
		);
	});

	it("exports upstream's slash-name pattern", () =>
	{
		expect(SLASH_NAME.exec("/plugin:skill-x rest")?.[1]).toBe("plugin:skill-x");
	});
});

describe("skillsCommandAction", () =>
{
	it("ports upstream's Hpe: bare opens, text after is trailing_args, only LF makes extra_lines", () =>
	{
		const inputs = [
			"/skills",
			"  /SKILLS  ",
			"/skills foo",
			"/skills\nfoo",
			"/skills\rfoo",
			"/skillsx",
			"/skill",
			"skills",
		];

		expect(Object.fromEntries(inputs.map((input) => [input, skillsCommandAction(input)]))).toStrictEqual(
			{
				"/skills": "open",
				"  /SKILLS  ": "open",
				"/skills foo": "trailing_args",
				"/skills\nfoo": "extra_lines",
				"/skills\rfoo": "trailing_args",
				"/skillsx": null,
				"/skill": null,
				skills: null,
			},
		);
	});
});

describe("routeSkillsCommand", () =>
{
	it("ports upstream's Upe: a CLI that lists /skills keeps every shape but the bare one unless the host row was picked", () =>
	{
		expect([
			routeSkillsCommand(
				{
					text: "/skills foo",
					cliListsOwn: true,
					hostRowPicked: false,
				},
			),
			routeSkillsCommand(
				{
					text: "/skills foo",
					cliListsOwn: false,
					hostRowPicked: false,
				},
			),
			routeSkillsCommand(
				{
					text: "/skills\nx",
					cliListsOwn: true,
					hostRowPicked: true,
				},
			),
			routeSkillsCommand(
				{
					text: "/skills",
					cliListsOwn: true,
					hostRowPicked: false,
				},
			),
			routeSkillsCommand(
				{
					text: "/skillsx",
					cliListsOwn: false,
					hostRowPicked: true,
				},
			),
		]).toStrictEqual([null, "trailing_args", "extra_lines", "open", null]);
	});
});

describe("routeStatusCommand", () =>
{
	it("shows the card when idle, notes without a session or mid-turn, and bands extra text", () =>
	{
		const idle =
		{
			hasSession: true,
			turnActive: false,
		};
		const inputs: [
			string,
			{
				hasSession: boolean;
				turnActive: boolean;
			},
		][] = [
			["/status", idle],
			["/STATUS ", idle],
			[
				"/status",
				{
					hasSession: true,
					turnActive: true,
				},
			],
			[
				"/status",
				{
					hasSession: false,
					turnActive: false,
				},
			],
			[
				"/status foo",
				{
					hasSession: false,
					turnActive: false,
				},
			],
			["/status\nx", idle],
			["/statusline", idle],
		];

		expect(inputs.map(([text, state]) => routeStatusCommand(text, state))).toStrictEqual([
			{
				kind: "card",
			},
			{
				kind: "card",
			},
			{
				kind: "notice",
				cause: "turn",
				text: "Session info is available when Claude finishes this turn.",
			},
			{
				kind: "notice",
				cause: "session",
				text: "Session info is available once the session starts.",
			},
			{
				kind: "band",
				text: trailingArgsBody("status"),
			},
			{
				kind: "band",
				text: extraLinesBody("status"),
			},
			null,
		]);
	});
});

describe("routeUsageCommand", () =>
{
	it("shows the card for the command as typed when idle, opens Settings otherwise, and bands extra text", () =>
	{
		const idle =
		{
			hasSession: true,
			turnActive: false,
		};
		const inputs: [
			string,
			{
				hasSession: boolean;
				turnActive: boolean;
			},
		][] = [
			["/usage", idle],
			["/COST ", idle],
			[
				"/usage",
				{
					hasSession: true,
					turnActive: true,
				},
			],
			[
				"/cost",
				{
					hasSession: false,
					turnActive: false,
				},
			],
			["/usage x", idle],
			["/cost\nx", idle],
			["/stats", idle],
			["/usages", idle],
		];

		expect(inputs.map(([text, state]) => routeUsageCommand(text, state))).toStrictEqual([
			{
				kind: "card",
				text: "/usage",
			},
			{
				kind: "card",
				text: "/COST",
			},
			{
				kind: "settings",
			},
			{
				kind: "settings",
			},
			{
				kind: "band",
				text: trailingArgsBody("usage"),
			},
			{
				kind: "band",
				text: extraLinesBody("cost"),
			},
			null,
			null,
		]);
	});
});

describe("planCommandArg", () =>
{
	it("ports upstream's Xle: the trimmed capture, empty when bare, multi-line allowed, null for anything else", () =>
	{
		expect(
			["/plan", "/PLAN  open ", "/plan\n a\nb", "/plans", "plan", " /plan x"].map(planCommandArg),
		).toStrictEqual(["", "open", "a\nb", null, null, "x"]);
	});
});

describe("routePlanCommand", () =>
{
	const base =
	{
		arg: "",
		currentMode: "default",
		planSelectable: true,
		hasPlan: true,
		olderMessagesNotLoaded: false,
		canOpenPane: true,
		paneAlreadyOpen: false,
		cliListsCommand: (name: string) => name === "a.b",
	};
	const run = (
		switchToPlan: boolean,
		openPane: boolean,
		notice: "already_in_plan" | "already_in_plan_no_plan" | null,
		send: string | null,
	) => (
	{
		kind: "run",
		switchToPlan,
		openPane,
		notice,
		send,
	});

	it("ports upstream's Zle for a bare /plan", () =>
	{
		expect([
			routePlanCommand(base),
			routePlanCommand(
				{
					...base,
					currentMode: "plan",
					hasPlan: false,
				},
			),
			routePlanCommand(
				{
					...base,
					currentMode: "plan",
					paneAlreadyOpen: true,
				},
			),
			routePlanCommand(
				{
					...base,
					currentMode: "plan",
					canOpenPane: false,
				},
			),
			routePlanCommand(
				{
					...base,
					currentMode: "plan",
					hasPlan: false,
					olderMessagesNotLoaded: true,
				},
			),
			routePlanCommand(
				{
					...base,
					currentMode: "plan",
				},
			),
		]).toStrictEqual([
			run(true, true, null, null),
			run(false, false, "already_in_plan_no_plan", null),
			run(false, false, "already_in_plan", null),
			run(false, false, "already_in_plan", null),
			run(false, true, null, null),
			run(false, true, null, null),
		]);
	});

	it("treats open and share (any case) as bare", () =>
	{
		expect(
			["open", "OPEN", "share"].map((arg) =>
				routePlanCommand(
					{
						...base,
						arg,
					},
				),
			),
		).toStrictEqual([run(true, true, null, null), run(true, true, null, null), run(true, true, null, null)]);
	});

	it("sends a description, switching first unless already in plan mode", () =>
	{
		expect([
			routePlanCommand(
				{
					...base,
					arg: "fix the bug",
				},
			),
			routePlanCommand(
				{
					...base,
					arg: "fix",
					currentMode: "plan",
				},
			),
			routePlanCommand(
				{
					...base,
					arg: "a /foo",
				},
			),
		]).toStrictEqual([
			run(true, false, null, "fix the bug"),
			run(false, false, null, "fix"),
			run(true, false, null, "a /foo"),
		]);
	});

	it("refuses a command-like description, including behind invisible characters", () =>
	{
		expect(
			["/foo", "!ls", "\u200b/foo", "/a.b"].map((arg) =>
				routePlanCommand(
					{
						...base,
						arg,
					},
				),
			),
		).toStrictEqual([
			{
				kind: "command_like",
			},
			{
				kind: "command_like",
			},
			{
				kind: "command_like",
			},
			{
				kind: "command_like",
			},
		]);
	});

	it("is unavailable when plan isn't selectable, unless a bare /plan can open the pane", () =>
	{
		const locked =
		{
			...base,
			planSelectable: false,
		};
		expect([
			routePlanCommand(
				{
					...locked,
					arg: "x",
				},
			),
			routePlanCommand(locked),
			routePlanCommand(
				{
					...locked,
					paneAlreadyOpen: true,
				},
			),
			routePlanCommand(
				{
					...locked,
					currentMode: "plan",
					arg: "x",
				},
			),
		]).toStrictEqual([
			{
				kind: "unavailable",
			},
			run(false, true, null, null),
			{
				kind: "unavailable",
			},
			run(false, false, null, "x"),
		]);
	});
});

describe("parseSignInCommand", () =>
{
	it("ports upstream's sign-in dispatch: the bridged toast for a bare /login or /logout, bands for the other shapes", () =>
	{
		const inputs = ["/login", "/LOGOUT", "/login x", "/login\nfoo", "/loginx", "/model"];

		expect(Object.fromEntries(inputs.map((input) => [input, parseSignInCommand(input)]))).toStrictEqual(
			{
				"/login":
				{
					kind: "sign-in",
					toast: "To change this session’s sign-in, run /login in Claude Code on the computer running this session.",
				},
				"/LOGOUT":
				{
					kind: "sign-in",
					toast: "To change this session’s sign-in, run /logout in Claude Code on the computer running this session.",
				},
				"/login x":
				{
					kind: "band",
					text: "/login doesn’t take arguments here. Remove the text after the command, then send it again.",
				},
				"/login\nfoo":
				{
					kind: "band",
					text: "/login only works on a single line. Remove the extra lines, then send it again.",
				},
				"/loginx": null,
				"/model": null,
			},
		);
	});

	it("names a valid host and falls back to upstream's phrase for an invalid one", () =>
	{
		expect(
			{
				valid: signInCommandToast("login", "Craigs-MBP.local"),
				invalid: signInCommandToast("login", "bad host!"),
				key: SIGN_IN_COMMAND_KEY,
			},
		).toStrictEqual(
			{
				valid: "To change this session’s sign-in, run /login in Claude Code on Craigs-MBP.local.",
				invalid:
					"To change this session’s sign-in, run /login in Claude Code on the computer running this session.",
				key: "epitaxy-sign-in-command",
			},
		);
	});
});
