// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {BackgroundTasksList} from "../src/components/panes/background-tasks-pane";
import type {BackgroundTask, BackgroundTaskGroups} from "../src/lib/background-tasks";

afterEach(cleanup);

function task(overrides: Partial<BackgroundTask> & Pick<BackgroundTask, "id">): BackgroundTask {
	return {
		toolUseId: null,
		kind: "bash",
		description: "",
		command: null,
		status: "running",
		output: null,
		summary: null,
		...overrides,
	};
}

const GROUPS: BackgroundTaskGroups = {
	running: [
		task({id: "bfab1serve", description: "Serve the fabricated app", command: "pnpm dev"}),
		task({id: "afab1review", kind: "agent", description: "Review the fabricated diff"}),
	],
	finished: [
		task({
			id: "bfab1build",
			description: "Build the fabricated app",
			command: "pnpm build",
			status: "completed",
			output: "built in 1.2s",
		}),
	],
};

function sections() {
	return screen.getAllByRole("heading").map((heading) => heading.textContent);
}

function cards() {
	return [...document.querySelectorAll("button[data-background-task]")].map((button) => button.textContent);
}

const POLL_GROUPS: BackgroundTaskGroups = {
	running: [],
	finished: [
		task({
			id: "bfab1poll",
			description: "Poll PR",
			command: "gh pr checks 42 --watch",
			status: "completed",
			output: "all checks passed",
		}),
	],
};

function regionSummary(name: string) {
	const region = screen.getByRole("region", {name});
	return {text: region.textContent, capped: region.classList.contains("max-h-[200px]")};
}

describe("BackgroundTasksList", () => {
	it("groups running and finished cards with kind and status meta, finished starting collapsed", () => {
		render(<BackgroundTasksList groups={GROUPS} />);

		expect({
			sections: sections(),
			cards: cards(),
			toggle: screen.getByRole("button", {name: "Finished 1"}).getAttribute("aria-expanded"),
		}).toStrictEqual({
			sections: ["2 running", "Finished 1"],
			cards: ["Serve the fabricated appBash · Running", "Review the fabricated diffAgent · Running"],
			toggle: "false",
		});
	});

	it("expands the finished section on click", () => {
		render(<BackgroundTasksList groups={GROUPS} />);

		fireEvent.click(screen.getByRole("button", {name: "Finished 1"}));

		expect({
			toggle: screen.getByRole("button", {name: "Finished 1"}).getAttribute("aria-expanded"),
			cards: cards(),
		}).toStrictEqual({
			toggle: "true",
			cards: [
				"Serve the fabricated appBash · Running",
				"Review the fabricated diffAgent · Running",
				"Build the fabricated appBash · Completed",
			],
		});
	});

	it("names each card button after its task", () => {
		render(<BackgroundTasksList groups={POLL_GROUPS} />);
		fireEvent.click(screen.getByRole("button", {name: "Finished 1"}));

		expect(screen.getByRole("button", {name: "Background task: Poll PR"}).getAttribute("aria-expanded")).toBe(
			"false",
		);
	});

	it("expands a card into capped Command and Output regions", () => {
		render(<BackgroundTasksList groups={POLL_GROUPS} />);
		fireEvent.click(screen.getByRole("button", {name: "Finished 1"}));
		const card = screen.getByRole("button", {name: "Background task: Poll PR"});

		fireEvent.click(card);

		expect({
			expanded: card.getAttribute("aria-expanded"),
			command: regionSummary("Command for Poll PR"),
			output: regionSummary("Output for Poll PR"),
		}).toStrictEqual({
			expanded: "true",
			command: {text: "$\u00a0gh pr checks 42 --watch", capped: true},
			output: {text: "all checks passed", capped: true},
		});
	});

	it("Clear finished tasks is an icon button that hides only the finished cards", () => {
		render(<BackgroundTasksList groups={GROUPS} />);
		fireEvent.click(screen.getByRole("button", {name: "Finished 1"}));
		const clear = screen.getByRole("button", {name: "Clear finished tasks"});

		const icon = clear.textContent;
		fireEvent.click(clear);

		expect({
			icon,
			sections: sections(),
			cards: cards(),
			clear: screen.queryByRole("button", {name: "Clear finished tasks"}),
		}).toStrictEqual({
			icon: "",
			sections: ["2 running"],
			cards: ["Serve the fabricated appBash · Running", "Review the fabricated diffAgent · Running"],
			clear: null,
		});
	});

	it("shows empty copy when there is no background work", () => {
		render(<BackgroundTasksList groups={{running: [], finished: []}} />);

		expect(screen.getByText("No background tasks in this session.").tagName).toBe("P");
	});
});
