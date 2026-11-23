import {describe, expect, it} from "vite-plus/test";
import
{
	permissionAnnouncement,
	ROWS_UNVOICED,
	spokenCap,
	TOKEN_WARNING_SPOKEN,
} from "../src/lib/permission-announcement";
import type {PermissionRow} from "../src/lib/permission-rows";

describe("spokenCap, as upstream's fo (ca8b34310 wb)", () =>
{
	it("collapses whitespace and trims", () =>
	{
		expect(spokenCap("  a\n  b\t")).toBe("a b");
	});

	it("keeps exactly 150 code points", () =>
	{
		const text = "😀".repeat(150);
		expect(spokenCap(text)).toBe(text);
	});

	it("cuts past 150 code points to the head and ', truncated'", () =>
	{
		expect(spokenCap(`${"x".repeat(150)}yz`)).toBe(`${"x".repeat(150)}, truncated`);
	});
});

describe("permissionAnnouncement, as upstream's Jy/qy/Yy", () =>
{
	it("reads a background Bash command's detail, note and description in upstream's order", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "run this command",
						meta: null,
					},
					detail: "ls -la",
					detailNote: "Keeps running in the background.",
					description: "List files",
				},
			),
		).toBe("Permission requested: run this command. ls -la. Keeps running in the background.. List files");
	});

	it("reads a file tool's path and then its name", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "edit",
						meta: "a.ts",
					},
					detail: "/r/a.ts",
				},
			),
		).toBe("Permission requested: edit. /r/a.ts, a.ts");
	});

	it("reads the meta alone when there is no detail", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "run skill",
						meta: "/x",
					},
					detail: null,
				},
			),
		).toBe("Permission requested: run skill, /x");
	});

	it("does not repeat a detail that equals the meta", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "read",
						meta: "a.ts",
					},
					detail: "a.ts",
				},
			),
		).toBe("Permission requested: read, a.ts");
	});

	it("reads a detail that equals the meta when a note follows it", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "read",
						meta: "a.ts",
					},
					detail: "a.ts",
					detailNote: "Lines 1 to 5",
				},
			),
		).toBe("Permission requested: read. a.ts, a.ts. Lines 1 to 5");
	});

	it("reads the action alone", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "run an agent",
						meta: null,
					},
					detail: null,
				},
			),
		).toBe("Permission requested: run an agent");
	});

	it("reads a heading title in full", () =>
	{
		const heading = `Claude needs ${"a".repeat(160)}`;
		expect(
			permissionAnnouncement(
				{
					title:
					{
						heading,
					},
					detail: null,
				},
			),
		).toBe(`Permission requested: ${heading}`);
	});

	it("names the origin of an action it had to cut", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: `use ${"t".repeat(160)}`,
						meta: null,
						origin: "Linear",
					},
					detail: null,
				},
			),
		).toBe(`Permission requested: use ${"t".repeat(146)}, truncated, from Linear`);
	});

	it("caps a long detail at 150 characters", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "run this command",
						meta: null,
					},
					detail: "y".repeat(200),
				},
			),
		).toBe(`Permission requested: run this command. ${"y".repeat(150)}, truncated`);
	});

	it("ends a workflow with the token warning, its link tags stripped", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "run the workflow",
						meta: "deploy",
					},
					detail: null,
					description: "Ship it",
					tokenWarning: true,
				},
			),
		).toBe(`Permission requested: run the workflow, deploy. Ship it. ${TOKEN_WARNING_SPOKEN}`);
		expect(TOKEN_WARNING_SPOKEN).toBe(
			"Dynamic workflows run many subagents in parallel and can use a lot of your usage limit. Stop them any time from the background tasks pane.",
		);
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "run the workflow",
						meta: "ok-ping",
					},
					detail: null,
					description: "Single agent that replies ok without using tools",
					folds: [
						{
							label: "Script",
							text: 'agent("reply ok")',
							lined: true,
						},
					],
					tokenWarning: true,
				},
			),
		).toBe(
			"Permission requested: run the workflow, ok-ping. 1 of 1, Script. Single agent that replies ok without using tools. Dynamic workflows run many subagents in parallel and can use a lot of your usage limit. Stop them any time from the background tasks pane.",
		);
	});

	it("reads a NotebookEdit card's open fold after its path, collapsed into the lead, then its note", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "edit",
						meta: "n.ipynb",
					},
					detail: "/repo/n.ipynb",
					detailNote: "Replaces cell c1.",
					folds: [
						{
							label: "New cell content",
							text: "x = 1\ny = 2\n",
							open: true,
							lined: true,
						},
					],
				},
			),
		).toBe("Permission requested: edit. /repo/n.ipynb New cell content: x = 1 y = 2, n.ipynb. Replaces cell c1.");
	});

	it("reads folds without a detail as rows after the meta, a closed fold by its label alone", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "run the workflow",
						meta: "sync",
					},
					detail: null,
					folds: [
						{
							label: "Script",
							text: "run()",
							lined: true,
						},
						{
							label: "Notes",
							text: "a\nb",
							open: true,
						},
					],
				},
			),
		).toBe("Permission requested: run the workflow, sync. 1 of 2, Script. 2 of 2, Notes: a b");
	});

	it("reads folds without a detail or meta as rows in the lead", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "run a workflow",
						meta: null,
					},
					detail: null,
					folds: [
						{
							label: "Script",
							text: "run()",
							lined: true,
						},
					],
				},
			),
		).toBe("Permission requested: run a workflow. 1 of 1, Script");
	});

	it("skips blank parts", () =>
	{
		expect(
			permissionAnnouncement(
				{
					title:
					{
						action: "run an agent",
						meta: null,
					},
					detail: null,
					description: "  \n ",
				},
			),
		).toBe("Permission requested: run an agent");
	});

	describe("rows voice, as upstream's By/Ly/Uy", () =>
	{
		const lead =
		{
			title:
			{
				action: "fetch",
				meta: "example.com",
			},
			detail: "https://example.com/",
		};
		const leadText = "Permission requested: fetch. https://example.com/, example.com";
		const letters = (count: number): PermissionRow[] =>
			Array.from(
				{
					length: count,
				},
				(_, index) => (
				{
					label: String.fromCodePoint(65 + index),
					value: String(index + 1),
				}),
			);

		it("reads one row as 1 of 1", () =>
		{
			expect(
				permissionAnnouncement(
					{
						...lead,
						rows: [
							{
								label: "Prompt",
								value: "sum",
							},
						],
					},
				),
			).toBe(`${leadText}. 1 of 1, Prompt: sum`);
		});

		it("reads the first ten rows and counts the rest", () =>
		{
			const rows = letters(12)
				.slice(0, 10)
				.map((row, index) => `${index + 1} of 12, ${row.label}: ${index + 1}`)
				.join(". ");
			expect(
				permissionAnnouncement(
					{
						...lead,
						rows: letters(12),
					},
				),
			).toBe(`${leadText}. ${rows}. and 2 more rows`);
		});

		it("counts a single row past ten in the singular", () =>
		{
			expect(
				permissionAnnouncement(
					{
						...lead,
						rows: letters(11),
					},
				).endsWith("10 of 11, J: 10. and 1 more row"),
			).toBe(true);
		});

		it("caps each row's label and value", () =>
		{
			expect(
				permissionAnnouncement(
					{
						...lead,
						rows: [
							{
								label: "Prompt",
								value: "p".repeat(151),
							},
						],
					},
				),
			).toBe(`${leadText}. 1 of 1, Prompt: ${"p".repeat(150)}, truncated`);
		});

		it("says the rows are on the card when they are unvoiced", () =>
		{
			expect(
				permissionAnnouncement(
					{
						...lead,
						rows: letters(2),
						rowsUnvoiced: true,
					},
				),
			).toBe(`${leadText}. ${ROWS_UNVOICED}`);
			expect(ROWS_UNVOICED).toBe("Some of what was sent can’t be read out here. It is listed on the card.");
		});

		it("says the rows are on the card when one is a group", () =>
		{
			expect(
				permissionAnnouncement(
					{
						...lead,
						rows: [
							{
								label: "options",
								labelCode: true,
								rows: letters(1),
							},
						],
					},
				),
			).toBe(`${leadText}. ${ROWS_UNVOICED}`);
		});

		it("reads bare rows after the description and before the token warning", () =>
		{
			expect(
				permissionAnnouncement(
					{
						...lead,
						description: "Why",
						tokenWarning: true,
						rows: letters(1),
					},
				),
			).toBe(`${leadText}. Why. 1 of 1, A: 1. ${TOKEN_WARNING_SPOKEN}`);
		});

		it("reads trail rows last, after the token warning", () =>
		{
			expect(
				permissionAnnouncement(
					{
						...lead,
						description: "Why",
						tokenWarning: true,
						rows: letters(1),
						rowsTrail: true,
					},
				),
			).toBe(`${leadText}. Why. ${TOKEN_WARNING_SPOKEN}. 1 of 1, A: 1`);
		});
	});
});
