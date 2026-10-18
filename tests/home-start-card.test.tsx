// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {useEffect, useRef} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {StartCard} from "../src/components/home/start-card";
import {onHomeComposerFocusRequest} from "../src/lib/home-composer-focus";
import type {StartProject} from "../src/lib/palette-start-session";

const PROJECTS: StartProject[] = [1, 2, 3, 4, 5].map((n) => ({
	id: `-users-dev-p${n}`,
	name: `p${n}`,
	projectPath: `/Users/dev/projects/p${n}`,
}));

/** Stands in for the docked composer: focuses its textarea on a home-composer focus request. */
function FakeComposer() {
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => onHomeComposerFocusRequest(() => ref.current?.focus()), []);
	return <textarea ref={ref} aria-label="Prompt" />;
}

function rows() {
	const list = screen.getByRole("list", {name: "Recent environments"});
	return within(list)
		.getAllByRole("listitem")
		.map((item) => ({
			text: item.textContent,
			current: item.getAttribute("aria-current"),
			title: item.querySelector("[title]")?.getAttribute("title") ?? null,
			button: item.querySelector("button")?.textContent ?? null,
			check: item.querySelector("[data-start-card-check]") !== null,
		}));
}

afterEach(() => {
	cleanup();
});

describe("StartCard", () => {
	it("shows the top two folders plus a selected 5th in the 3rd seat, checked and static", () => {
		render(<StartCard projects={PROJECTS} selected={PROJECTS[4]} onSelect={() => {}} />);

		expect(rows()).toStrictEqual([
			{text: "p1", current: null, title: "~/projects/p1", button: "p1", check: false},
			{text: "p2", current: null, title: "~/projects/p2", button: "p2", check: false},
			{text: "p5", current: "true", title: "~/projects/p5", button: null, check: true},
			{
				text: "Choose environment",
				current: null,
				title: null,
				button: "Choose environment",
				check: false,
			},
		]);
	});

	it("keeps the top three when the selection is among them", () => {
		render(<StartCard projects={PROJECTS} selected={PROJECTS[1]} onSelect={() => {}} />);

		expect(rows().map(({text, current}) => ({text, current}))).toStrictEqual([
			{text: "p1", current: null},
			{text: "p2", current: "true"},
			{text: "p3", current: null},
			{text: "Choose environment", current: null},
		]);
	});

	it("renders nothing without folders", () => {
		const {container} = render(<StartCard projects={[]} selected={undefined} onSelect={() => {}} />);

		expect(container.innerHTML).toBe("");
	});

	it("selects a clicked row and focuses the composer", () => {
		const onSelect = vi.fn<(projectId: string) => void>();
		render(
			<>
				<StartCard projects={PROJECTS} selected={PROJECTS[0]} onSelect={onSelect} />
				<FakeComposer />
			</>,
		);

		fireEvent.click(screen.getByRole("button", {name: "p2"}));

		expect({
			calls: onSelect.mock.calls,
			focused: document.activeElement?.getAttribute("aria-label"),
		}).toStrictEqual({calls: [["-users-dev-p2"]], focused: "Prompt"});
	});

	it("opens the project picker from Choose environment and focuses the composer on a pick", async () => {
		const onSelect = vi.fn<(projectId: string) => void>();
		render(
			<>
				<StartCard projects={PROJECTS} selected={PROJECTS[0]} onSelect={onSelect} />
				<FakeComposer />
			</>,
		);

		fireEvent.click(screen.getByRole("button", {name: "Choose environment"}));
		const listbox = await screen.findByRole("listbox", {name: "Projects"});
		fireEvent.click(within(listbox).getByRole("option", {name: "p4"}));

		expect({
			calls: onSelect.mock.calls,
			focused: document.activeElement?.getAttribute("aria-label"),
		}).toStrictEqual({calls: [["-users-dev-p4"]], focused: "Prompt"});
	});
});
