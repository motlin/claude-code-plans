// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, render, screen, within} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {SessionPlanPane} from "../src/components/panes/plan-pane";
import {withPendingPlan, type SessionPlanModel} from "../src/lib/session-plan-model";

afterEach(() => {
	cleanup();
});

function withQueryClient(node: ReactNode) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	return <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>;
}

const EMPTY: SessionPlanModel = {content: null, todos: [], editsPlanFile: false};

describe("SessionPlanPane", () => {
	it("shows a hook-only pending plan, which the docked approval card no longer repeats", () => {
		const model = withPendingPlan(EMPTY, {toolUseId: "", plan: "# P\n\nDo it.", planFilePath: "/tmp/plans/p.md"});
		render(withQueryClient(<SessionPlanPane planFilename={undefined} model={model} />));
		const pane = screen.getByTestId("session-plan-pane");

		expect(
			within(pane)
				.getAllByRole("heading")
				.map((heading) => heading.textContent),
		).toStrictEqual(["P"]);
	});

	it("shows upstream's empty state when the session has no plan and no todos", () => {
		render(withQueryClient(<SessionPlanPane planFilename={undefined} model={EMPTY} />));
		const pane = screen.getByTestId("session-plan-pane");

		expect({
			paragraphs: Array.from(pane.querySelectorAll("p"), (p) => [p.className, p.textContent]),
			icon: pane.querySelector("svg")?.getAttribute("class"),
			className: pane.className,
		}).toStrictEqual({
			paragraphs: [
				["max-w-[36ch] text-pretty break-words text-body text-primary", "No plan yet"],
				[
					"max-w-[36ch] text-pretty break-words text-footnote text-ink-muted",
					"Claude writes the plan here as it explores. Keep chatting.",
				],
			],
			icon: "lucide lucide-list-checks size-7 text-ink-muted",
			className: "flex h-full flex-col items-center justify-center gap-3 px-4 py-4 text-center",
		});
	});

	it("renders the plan as prose in a 68ch column with the todos under a Tasks heading", () => {
		const model: SessionPlanModel = {
			content: "# Fabricated plan\n\nRebase the fabricated fork.",
			todos: [
				{content: "Rebase", status: "completed"},
				{content: "Resolve conflicts", status: "in_progress", activeForm: "Resolving conflicts"},
				{content: "Push", status: "pending"},
			],
			editsPlanFile: false,
		};
		render(withQueryClient(<SessionPlanPane planFilename={undefined} model={model} />));
		const pane = screen.getByTestId("session-plan-pane");
		const column = pane.firstElementChild;
		const section = within(pane).getByRole("heading", {name: "Tasks"}).parentElement;

		expect({
			className: pane.className,
			column: column?.className,
			heading: within(pane).getByRole("heading", {level: 1}).textContent,
			body: within(pane).getByText("Rebase the fabricated fork.").tagName,
			section: [section?.tagName, section?.className, section?.parentElement === column],
			tasksHeading: within(pane).getByRole("heading", {name: "Tasks"}).className,
			todos: within(pane)
				.getAllByRole("listitem")
				.map((item) => [item.textContent, item.getAttribute("data-todo-status")]),
		}).toStrictEqual({
			className: "h-full select-text overflow-y-auto [contain:strict] [scrollbar-gutter:stable_both-edges] p-4",
			column: "mx-auto max-w-[68ch]",
			heading: "Fabricated plan",
			body: "P",
			section: ["SECTION", "mt-4", true],
			tasksHeading: "mb-1.25 text-caption font-medium uppercase tracking-wide text-ink-muted",
			todos: [
				["doneRebase", "completed"],
				["in progressResolve conflicts", "in_progress"],
				["Push", "pending"],
			],
		});
	});

	it("renders only the Tasks section when there are todos but no plan text", () => {
		const model: SessionPlanModel = {
			content: null,
			todos: [{content: "Rebase", status: "pending"}],
			editsPlanFile: false,
		};
		render(withQueryClient(<SessionPlanPane planFilename={undefined} model={model} />));
		const pane = screen.getByTestId("session-plan-pane");

		expect({
			headings: within(pane)
				.getAllByRole("heading")
				.map((heading) => heading.textContent),
			todos: within(pane)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
			empty: within(pane).queryByText("No plan yet"),
		}).toStrictEqual({headings: ["Tasks"], todos: ["Rebase"], empty: null});
	});
});
