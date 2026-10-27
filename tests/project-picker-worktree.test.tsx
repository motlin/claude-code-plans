// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {ProjectPicker, type ProjectPickerWorktree} from "../src/components/home/project-picker";

const projects = [
	{id: "a", name: "alpha", projectPath: "/a"},
	{id: "b", name: "beta", projectPath: "/b"},
];

function renderPicker(worktree: ProjectPickerWorktree) {
	render(<ProjectPicker projects={projects} selected={projects[0]} onSelect={() => {}} worktree={worktree} />);
	fireEvent.click(screen.getByRole("combobox", {name: "Folder: alpha"}));
	return screen.getByRole("textbox", {name: "Search projects"});
}

function worktreeRow(): HTMLElement | null {
	return document.querySelector<HTMLElement>("[data-testid=environment-bar-worktree]");
}

function rowState() {
	const row = worktreeRow();
	if (row === null) return null;
	const toggle = row.querySelector("[role=switch]");
	return {
		role: row.getAttribute("role"),
		selected: row.getAttribute("aria-selected"),
		text: row.textContent,
		highlighted: row.hasAttribute("data-highlighted"),
		disabled: row.hasAttribute("data-disabled"),
		ariaDisabled: row.getAttribute("aria-disabled"),
		checked: toggle?.getAttribute("aria-checked"),
		label: toggle?.getAttribute("aria-label"),
		switchDisabled: toggle?.hasAttribute("data-disabled"),
		separatorBefore: row.previousElementSibling?.getAttribute("role"),
	};
}

describe("ProjectPicker worktree footer", () => {
	afterEach(() => {
		cleanup();
	});

	it("shows a separator and the Worktree row with an off switch while the query is empty", () => {
		renderPicker({enabled: false, supported: true, set: vi.fn<(enabled: boolean) => void>()});
		expect(rowState()).toStrictEqual({
			role: "option",
			selected: "false",
			text: "Worktree",
			highlighted: false,
			disabled: false,
			ariaDisabled: null,
			checked: "false",
			label: "Worktree",
			switchDisabled: false,
			separatorBefore: "separator",
		});
	});

	it("hides the footer while the search has text", () => {
		const search = renderPicker({enabled: false, supported: true, set: vi.fn<(enabled: boolean) => void>()});
		fireEvent.change(search, {target: {value: "x"}});
		expect(worktreeRow()).toBeNull();
		expect(document.querySelector("[role=separator]")).toBeNull();
	});

	it("highlights the row after the last project and toggles on Enter, staying open", () => {
		const set = vi.fn<(enabled: boolean) => void>();
		const search = renderPicker({enabled: false, supported: true, set});
		fireEvent.keyDown(search, {key: "ArrowDown"});
		fireEvent.keyDown(search, {key: "ArrowDown"});
		fireEvent.keyDown(search, {key: "ArrowDown"});
		expect(rowState()?.highlighted).toBe(true);
		expect(search.getAttribute("aria-activedescendant")).toBe(worktreeRow()?.id);
		fireEvent.keyDown(search, {key: "Enter"});
		expect(set.mock.calls).toStrictEqual([[true]]);
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(document.activeElement).toBe(search);
	});

	it("toggles on Space while the row is highlighted", () => {
		const set = vi.fn<(enabled: boolean) => void>();
		const search = renderPicker({enabled: true, supported: true, set});
		fireEvent.keyDown(search, {key: "ArrowDown"});
		fireEvent.keyDown(search, {key: "ArrowDown"});
		fireEvent.keyDown(search, {key: " "});
		expect(set.mock.calls).toStrictEqual([[false]]);
		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("toggles on click without closing or selecting a folder", () => {
		const set = vi.fn<(enabled: boolean) => void>();
		const onSelect = vi.fn<(projectId: string) => void>();
		render(
			<ProjectPicker
				projects={projects}
				selected={projects[0]}
				onSelect={onSelect}
				worktree={{enabled: true, supported: true, set}}
			/>,
		);
		fireEvent.click(screen.getByRole("combobox", {name: "Folder: alpha"}));
		const row = worktreeRow();
		if (row === null) throw new Error("no worktree row");
		fireEvent.click(row);
		expect({
			set: set.mock.calls,
			onSelect: onSelect.mock.calls,
			open: screen.queryByRole("dialog") !== null,
		}).toStrictEqual({
			set: [[false]],
			onSelect: [],
			open: true,
		});
		expect(rowState()?.checked).toBe("true");
	});

	it("renders no footer for a folder known not to be a git repo", () => {
		renderPicker({enabled: true, supported: false, set: vi.fn<(enabled: boolean) => void>(), isGitRepo: false});
		expect(worktreeRow()).toBeNull();
		expect(document.querySelector("[role=separator]")).toBeNull();
	});

	it("disables the row when unsupported in a git checkout, and a click is a no-op", () => {
		const set = vi.fn<(enabled: boolean) => void>();
		renderPicker({enabled: true, supported: false, set, isGitRepo: true});
		expect(rowState()).toStrictEqual({
			role: "option",
			selected: "false",
			text: "Worktree",
			highlighted: false,
			disabled: true,
			ariaDisabled: "true",
			checked: "true",
			label: "Worktree",
			switchDisabled: true,
			separatorBefore: "separator",
		});
		const row = worktreeRow();
		if (row === null) throw new Error("no worktree row");
		fireEvent.click(row);
		expect(set.mock.calls).toStrictEqual([]);
	});

	it("has no footer without a worktree prop", () => {
		render(<ProjectPicker projects={projects} selected={projects[0]} onSelect={() => {}} />);
		fireEvent.click(screen.getByRole("combobox", {name: "Folder: alpha"}));
		expect(worktreeRow()).toBeNull();
	});
});
