// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ProjectPicker} from "../src/components/home/project-picker";
import {DensityProvider} from "../src/components/ui/density";
import type {StartProject} from "../src/lib/palette-start-session";

const COLLIDING: StartProject[] = [
	{
		id: "x",
		name: "Factorio-FBSR",
		projectPath: "/Users/dev/projects/Factorio-FBSR",
	},
	{
		id: "y",
		name: "BlueprintBot/Factorio-FBSR",
		projectPath: "/Users/dev/projects/FactorioBlueprints/BlueprintBot/Factorio-FBSR",
	},
	{
		id: "z",
		name: "p3",
		projectPath: "/Users/dev/projects/p3",
	},
];

const TEN: StartProject[] = Array.from(
	{
		length: 10,
	},
	(_, i) => (
	{
		id: `p${i + 1}`,
		name: `p${i + 1}`,
		projectPath: `/Users/dev/projects/p${i + 1}`,
	}),
);

const FOLDER_DESCRIPTION_CLASS = "break-words text-footnote text-[var(--menu-muted)]";

afterEach(() =>
{
	cleanup();
});

function openPicker(projects: readonly StartProject[], selected?: StartProject)
{
	render(
		<DensityProvider density="compact">
			<ProjectPicker
				projects={projects}
				selected={selected}
				onSelect={() =>
				{
				}}
			/>
		</DensityProvider>,
	);
	fireEvent.click(screen.getByRole("combobox"));
	return screen.getByRole(
		"textbox",
		{
			name: "Search projects",
		},
	);
}

function type(search: HTMLElement, value: string)
{
	fireEvent.change(
		search,
		{
			target:
			{
				value,
			},
		},
	);
}

function options()
{
	return screen.getAllByRole("option").map((option) =>
	{
		const description = option.querySelector("[data-folder-description]");
		return {
			name: option.querySelector("[data-folder-name]")?.textContent ?? null,
			description: description?.textContent ?? null,
			title: option.getAttribute("title"),
		};
	});
}

describe("ProjectPicker folder rows", () =>
{
	it("titles rows by basename with the parent folder as a description on a basename collision", () =>
	{
		openPicker(COLLIDING);

		expect(options()).toStrictEqual([
			{
				name: "Factorio-FBSR",
				description: "~/projects",
				title: "/Users/dev/projects/Factorio-FBSR",
			},
			{
				name: "Factorio-FBSR",
				description: "~/projects/FactorioBlueprints/BlueprintBot",
				title: "/Users/dev/projects/FactorioBlueprints/BlueprintBot/Factorio-FBSR",
			},
			{
				name: "p3",
				description: null,
				title: "/Users/dev/projects/p3",
			},
		]);
	});

	it("names a nested worktree by its basename with no description", () =>
	{
		openPicker([
			{
				id: "w",
				name: "kalshi/.claude/worktrees/discover",
				projectPath: "/Users/dev/projects/kalshi/.claude/worktrees/discover",
			},
		]);

		expect(options()).toStrictEqual([
			{
				name: "discover",
				description: null,
				title: "/Users/dev/projects/kalshi/.claude/worktrees/discover",
			},
		]);
	});

	it("drops the description once the query filters out the collision partner", () =>
	{
		type(openPicker(COLLIDING), "blueprintbot");

		expect(options()).toStrictEqual([
			{
				name: "Factorio-FBSR",
				description: null,
				title: "/Users/dev/projects/FactorioBlueprints/BlueprintBot/Factorio-FBSR",
			},
		]);
	});

	it("grows a described row to two lines with upstream's description type and padding", () =>
	{
		openPicker(COLLIDING);
		const [described] = screen.getAllByRole("option");

		expect(
			{
				density: described!.closest("[data-density]")?.getAttribute("data-density"),
				description: described!.querySelector("[data-folder-description]")?.getAttribute("class"),
				described: described!.className.split(" ").filter((token) => /^(?:min-)?h-|^p[btxy]?-/.test(token)),
				plain: screen
					.getAllByRole("option")[2]!
					.className.split(" ")
					.filter((token) => /^(?:min-)?h-|^p[btxy]?-/.test(token)),
				wrapper: described!.firstElementChild?.getAttribute("class"),
			},
		).toStrictEqual(
			{
				density: "compact",
				description: FOLDER_DESCRIPTION_CLASS,
				described: [
					"min-h-6",
					"px-2",
					"py-[calc((var(--cds-h-control)-var(--upstream-leading-body))/2)]",
					"pb-[calc((var(--cds-h-control)-var(--upstream-text-body)-var(--upstream-leading-footnote)+var(--upstream-text-footnote))/2)]",
				],
				plain: ["min-h-6", "px-2"],
				wrapper: "flex min-w-0 flex-1 flex-col",
			},
		);
	});
});

describe("ProjectPicker Recent group", () =>
{
	it("shows the eight most recent folders under a Recent label with an empty query", () =>
	{
		openPicker(TEN);

		expect(
			{
				group: screen
					.getByRole(
						"group",
						{
							name: "Recent",
						},
					)
					.querySelectorAll("[role=option]").length,
				options: options().map((option) => option.name),
			},
		).toStrictEqual(
			{
				group: 8,
				options: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"],
			},
		);
	});

	it("keeps a selected folder outside the eight as a ninth row", () =>
	{
		openPicker(TEN, TEN[9]);

		expect(options().map((option) => option.name)).toStrictEqual([
			"p1",
			"p2",
			"p3",
			"p4",
			"p5",
			"p6",
			"p7",
			"p8",
			"p10",
		]);
	});

	it("searches every folder by its shortened path, hiding the Recent label", () =>
	{
		type(openPicker(TEN), "~/projects/p1");

		expect(
			{
				group: screen.queryByText("Recent"),
				options: options().map((option) => option.name),
			},
		).toStrictEqual(
			{
				group: null,
				options: ["p1", "p10"],
			},
		);
	});

	it("says No matches in upstream's muted footnote when nothing matches", () =>
	{
		type(openPicker(TEN), "zzz");
		const empty = screen.getByText("No matches");

		expect(
			{
				className: empty.className,
				tag: empty.tagName,
				group: screen.queryByText("Recent"),
			},
		).toStrictEqual(
			{
				className: "px-2 py-1 text-footnote text-muted-as-secondary",
				tag: "DIV",
				group: null,
			},
		);
	});
});
