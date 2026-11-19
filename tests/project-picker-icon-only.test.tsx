// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {ProjectPicker} from "../src/components/home/project-picker";
import {PathBreak} from "../src/components/ui/path-break";
import {EnvironmentBarIconOnlyContext} from "../src/components/use-environment-bar-icon-only";

const projects = [
	{
		id: "x",
		name: "x",
		projectPath: "/Users/craig/x",
	},
];

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
});

function renderPicker(iconOnly: boolean, withFolder = true)
{
	render(
		<EnvironmentBarIconOnlyContext.Provider value={iconOnly}>
			<ProjectPicker
				projects={projects}
				selected={withFolder ? projects[0] : undefined}
				onSelect={() =>
				{
				}}
			/>
		</EnvironmentBarIconOnlyContext.Provider>,
	);
	return screen.getByRole("combobox");
}

function hover(trigger: HTMLElement)
{
	vi.useFakeTimers();
	fireEvent.pointerEnter(
		trigger.parentElement!,
		{
			pointerType: "mouse",
		},
	);
	act(() =>
	{
		vi.advanceTimersByTime(1000);
	});
}

function chipState(trigger: HTMLElement)
{
	return {
		iconOnly: trigger.getAttribute("data-icon-only"),
		title: trigger.getAttribute("title"),
		ariaLabel: trigger.getAttribute("aria-label"),
		iconClass: trigger.querySelector("svg")?.getAttribute("class"),
		labelClass: trigger.lastElementChild?.className,
	};
}

describe("ProjectPicker in a collapsed environment bar", () =>
{
	it("drops its label to sr-only text and its title, keeping the Folder name", () =>
	{
		const trigger = renderPicker(true);

		expect(chipState(trigger)).toStrictEqual(
			{
				iconOnly: "",
				title: null,
				ariaLabel: "Folder: x",
				iconClass: "lucide lucide-folder ms-0.5 -me-0.5 size-4 shrink-0",
				labelClass: "sr-only",
			},
		);
	});

	it("shows the full path, broken after each separator, as its hover tooltip", () =>
	{
		hover(renderPicker(true));
		const content = screen.getByRole("tooltip").firstElementChild!;

		expect(
			{
				dir: content.getAttribute("dir"),
				pieces: [...content.children].map((piece) => [piece.className, piece.textContent]),
			},
		).toStrictEqual(
			{
				dir: "ltr",
				pieces: [
					["inline-block max-w-full whitespace-pre-wrap", "/"],
					["inline-block max-w-full whitespace-pre-wrap", "Users/"],
					["inline-block max-w-full whitespace-pre-wrap", "craig/"],
					["inline-block max-w-full whitespace-pre-wrap", "x"],
				],
			},
		);
	});

	it("shows the placeholder label as the tooltip with no folder, its icon muted", () =>
	{
		const trigger = renderPicker(true, false);
		const iconClass = trigger.querySelector("svg")?.getAttribute("class");
		hover(trigger);

		expect(
			{
				iconClass,
				tooltip: screen.getByRole("tooltip").textContent,
			},
		).toStrictEqual(
			{
				iconClass: "lucide lucide-folder ms-0.5 -me-0.5 text-muted-control size-4 shrink-0",
				tooltip: "Select project…",
			},
		);
	});

	it("shows no tooltip while its popover is open", () =>
	{
		const trigger = renderPicker(true);
		fireEvent.click(trigger);
		hover(trigger);

		expect(screen.queryByRole("tooltip")).toBeNull();
	});
});

describe("ProjectPicker in an expanded environment bar", () =>
{
	it("shows its label and carries the full path as its title, with no tooltip", () =>
	{
		const trigger = renderPicker(false);
		const state = chipState(trigger);
		hover(trigger);

		expect(
			{
				...state,
				tooltip: screen.queryByRole("tooltip"),
			},
		).toStrictEqual(
			{
				iconOnly: null,
				title: "/Users/craig/x",
				ariaLabel: "Folder: x",
				iconClass: "lucide lucide-folder ms-0.5 me-0.5 size-4 shrink-0",
				labelClass: "flex min-w-0 max-w-64 items-center gap-xs",
				tooltip: null,
			},
		);
	});
});

describe("PathBreak", () =>
{
	it.each([
		["C:\\a\\b", ["C:\\", "a\\", "b"]],
		["plain", ["plain"]],
	])("splits %s after each separator", (path, pieces) =>
	{
		const {container} = render(<PathBreak path={path} />);

		expect([...container.firstElementChild!.children].map((piece) => piece.textContent)).toStrictEqual(pieces);
	});
});
