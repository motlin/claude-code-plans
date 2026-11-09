// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ProjectPicker} from "../src/components/home/project-picker";

const projects = [
	{id: "a", name: "alpha", projectPath: "/a"},
	{id: "b", name: "beta", projectPath: "/b"},
];

afterEach(() => {
	cleanup();
});

describe("ProjectPicker without the Worktree footer", () => {
	it("lists only the folders: the Worktree switch moved to the environment bar's chip", () => {
		render(<ProjectPicker projects={projects} selected={projects[0]} onSelect={() => {}} />);
		fireEvent.click(screen.getByRole("combobox", {name: "Folder: alpha"}));
		const search = screen.getByRole("textbox", {name: "Search projects"});
		fireEvent.keyDown(search, {key: "ArrowDown"});
		fireEvent.keyDown(search, {key: "ArrowDown"});

		expect({
			footer: document.querySelector("[data-testid=environment-bar-worktree]"),
			separator: document.querySelector("[role=separator]"),
			options: screen.getAllByRole("option").map((option) => option.textContent),
			active: search.getAttribute("aria-activedescendant")?.endsWith("-b") ?? false,
		}).toStrictEqual({footer: null, separator: null, options: ["alpha", "beta"], active: true});
	});
});
