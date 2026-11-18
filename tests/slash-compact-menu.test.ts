import {describe, expect, it} from "vite-plus/test";
import
{
	buildCompactSlashMenu,
	COMPACT_SLASH_MENU_HOST,
	COMPACT_SLASH_MENU_LABELS,
	type CompactSlashMenuInput,
} from "../src/lib/slash-compact-menu";
import type {SlashCommand, SlashMenuItem} from "../src/lib/slash-commands";

function skill(name: string, source: SlashCommand["source"] = "personal-skill"): SlashCommand
{
	return {
		name,
		description: `${name} skill`,
		source,
	};
}

function builtin(name: string): SlashCommand
{
	return {
		name,
		description: `${name} command`,
		source: "builtin",
	};
}

const row = (command: SlashCommand): SlashMenuItem => (
{
	type: "command",
	command,
});

const HOST_ROWS: SlashMenuItem[] = [
	{
		type: "submenu",
		label: "Model",
		value: "Opus 5.5",
		flyout: "model",
		items: [],
	},
	{
		type: "host",
		label: "Environment",
		value: "Local",
		disabled: true,
		undimmed: true,
	},
];

const COMPACT = builtin("compact");
const SKILLS = builtin("skills");
const CLEAR = builtin("clear");
const STANDUP: SlashCommand =
{
	name: "standup",
	description: "Write my standup",
	source: "personal-command",
};

function input(
	commands: readonly SlashCommand[],
	overrides: Partial<CompactSlashMenuInput> = {},
): CompactSlashMenuInput
{
	return {
		commands,
		notices: [],
		hostRows: HOST_ROWS,
		inSession: true,
		usageScore: () => 0,
		isOwnSkill: () => true,
		labels: COMPACT_SLASH_MENU_LABELS,
		...overrides,
	};
}

describe("buildCompactSlashMenu (upstream jr)", () =>
{
	it("ships on locally, mirroring upstream's __gb__3159821575 gate (M6)", () =>
	{
		expect(COMPACT_SLASH_MENU_HOST).toBe(true);
	});

	it("leads with the top 3 skills by usage, own skills first, then an All skills submenu sorted by label", () =>
	{
		const [alpha, beta, dataviz, gamma, review] = ["alpha", "beta", "dataviz", "gamma", "review"].map((name) =>
			skill(name, name === "alpha" ? "personal-skill" : "plugin-skill"),
		) as [SlashCommand, SlashCommand, SlashCommand, SlashCommand, SlashCommand];
		const usage: Record<string, number> =
		{
			review: 3,
			dataviz: 1,
		};
		const items = buildCompactSlashMenu(
			input(
				[gamma, review, CLEAR, beta, dataviz, COMPACT, alpha, STANDUP],
				{
					usageScore: (command) => usage[command.name] ?? 0,
					isOwnSkill: (command) => command.name === "alpha",
				},
			),
		);
		expect(items).toStrictEqual([
			{
				type: "section-header",
				label: "Skills",
			},
			row(review),
			row(dataviz),
			row(alpha),
			{
				type: "submenu",
				label: "All skills",
				items: [row(alpha), row(beta), row(dataviz), row(gamma), row(review)],
			},
			{
				type: "separator",
				label: "compact-1",
			},
			...HOST_ROWS,
			{
				type: "command",
				command: COMPACT,
				label: "Compact session",
			},
			{
				type: "separator",
				label: "compact-2",
			},
			{
				type: "submenu",
				label: "All commands",
				items: [row(CLEAR), row(COMPACT), row(STANDUP)],
			},
		]);
	});

	it("shows three or fewer skills inline with no All skills submenu", () =>
	{
		const skills = [skill("c"), skill("a"), skill("b")];
		expect(
			buildCompactSlashMenu(
				input(
					skills,
					{
						hostRows: [],
						inSession: false,
					},
				),
			),
		).toStrictEqual([
			{
				type: "section-header",
				label: "Skills",
			},
			...skills.map(row),
		]);
	});

	it("relabels /skills as Manage skills with no skills, and drops the group when there is no /skills", () =>
	{
		expect(
			buildCompactSlashMenu(
				input(
					[SKILLS, CLEAR],
					{
						hostRows: [],
						inSession: false,
					},
				),
			),
		).toStrictEqual([
			{
				type: "command",
				command: SKILLS,
				label: "Manage skills",
			},
			{
				type: "separator",
				label: "compact-1",
			},
			{
				type: "submenu",
				label: "All commands",
				items: [row(SKILLS), row(CLEAR)],
			},
		]);
		expect(
			buildCompactSlashMenu(
				input(
					[CLEAR],
					{
						hostRows: [],
						inSession: false,
					},
				),
			),
		).toStrictEqual([
			{
				type: "submenu",
				label: "All commands",
				items: [row(CLEAR)],
			},
		]);
	});

	it("leaves Compact session out of the home draft", () =>
	{
		expect(
			buildCompactSlashMenu(
				input(
					[COMPACT],
					{
						inSession: false,
					},
				),
			),
		).toStrictEqual([
			...HOST_ROWS,
			{
				type: "separator",
				label: "compact-1",
			},
			{
				type: "submenu",
				label: "All commands",
				items: [row(COMPACT)],
			},
		]);
	});

	it("leads with the notices and no separator", () =>
	{
		expect(
			buildCompactSlashMenu(
				input(
					[CLEAR],
					{
						hostRows: [],
						notices: ["More commands available once the session is running"],
					},
				),
			),
		).toStrictEqual([
			{
				type: "section-header",
				label: "More commands available once the session is running",
			},
			{
				type: "submenu",
				label: "All commands",
				items: [row(CLEAR)],
			},
		]);
	});

	it("collapses duplicate rows with the same name, routing, source and description", () =>
	{
		const a = skill("alpha");
		expect(
			buildCompactSlashMenu(
				input(
					[
						a,
						{
							...a,
						},
						{
							...a,
							description: "other",
						},
					],
					{
						hostRows: [],
					},
				),
			),
		).toStrictEqual([
			{
				type: "section-header",
				label: "Skills",
			},
			row(a),
			row(
				{
					...a,
					description: "other",
				},
			),
		]);
	});
});
