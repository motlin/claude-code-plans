// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {useEffect, useRef} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {NextStepsList} from "../src/components/home/start-card";
import {onHomeComposerFocusRequest} from "../src/lib/home-composer-focus";
import {selectNextSteps, type NextStepCandidate} from "../src/lib/home-next-steps";

function blocked(n: number): NextStepCandidate[] {
	return Array.from({length: n}, (_, index) => ({
		id: "waiting-session",
		subject: `s${index + 1}`,
		stamp: 100,
		title: `Task ${index + 1}`,
		detail: index % 2 === 0 ? "Asked a question" : "Needs permission",
	}));
}

function rowsOf(n: number) {
	return selectNextSteps({candidates: blocked(n), dismissed: {}});
}

function FakeComposer() {
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => onHomeComposerFocusRequest(() => ref.current?.focus()), []);
	return <textarea ref={ref} aria-label="Prompt" />;
}

afterEach(() => {
	cleanup();
});

describe("NextStepsList", () => {
	it("renders Blocked rows with their detail and a touch-revealed dismiss", () => {
		render(<NextStepsList rows={rowsOf(2)} onOpen={() => {}} onDismiss={() => {}} />);

		const list = screen.getByRole("list", {name: "Next steps"});
		const items = within(list).getAllByRole("listitem");
		expect(
			items.map((item) => ({
				text: item.querySelector("[data-next-step-open]")?.textContent,
				status: item.querySelector(".text-upstream-warning")?.textContent,
				dismiss: item.querySelector("[data-next-step-dismiss]")?.getAttribute("aria-label"),
			})),
		).toStrictEqual([
			{text: "Blocked Task 1Asked a question", status: "Blocked", dismiss: "Dismiss “Task 1”"},
			{text: "Blocked Task 2Needs permission", status: "Blocked", dismiss: "Dismiss “Task 2”"},
		]);
		const dismissClass = screen.getByRole("button", {name: "Dismiss “Task 1”"}).className.split(" ");
		expect(
			["opacity-0", "pointer-coarse:opacity-100", "[@media(hover:none)]:opacity-100"].map((token) =>
				dismissClass.includes(token),
			),
		).toStrictEqual([true, true, true]);
	});

	it("shows a failing PR row without the Blocked status", () => {
		const rows = selectNextSteps({
			candidates: [
				...blocked(1),
				{
					id: "pr-ci-failed",
					subject: "p1",
					stamp: 100,
					title: "Fix the failing checks",
					detail: "2 failing checks",
				},
			],
			dismissed: {},
		});
		render(<NextStepsList rows={rows} onOpen={() => {}} onDismiss={() => {}} />);

		expect(
			screen.getAllByRole("listitem").map((item) => item.querySelector("[data-next-step-open]")?.textContent),
		).toStrictEqual(["Blocked Task 1Asked a question", "Fix the failing checks2 failing checks"]);
	});

	it("opens the session on press", () => {
		const onOpen = vi.fn<(sessionId: string) => void>();
		render(<NextStepsList rows={rowsOf(2)} onOpen={onOpen} onDismiss={() => {}} />);

		fireEvent.click(screen.getByRole("button", {name: /^Blocked Task 2/}));

		expect(onOpen.mock.calls).toStrictEqual([["s2"]]);
	});

	it("lists the remaining sessions in the rest row's popup and dismisses them together", async () => {
		const onOpen = vi.fn<(sessionId: string) => void>();
		const onDismiss = vi.fn<(candidates: NextStepCandidate[]) => void>();
		render(<NextStepsList rows={rowsOf(5)} onOpen={onOpen} onDismiss={onDismiss} />);

		fireEvent.click(screen.getByRole("button", {name: "Dismiss 3 blocked sessions"}));
		fireEvent.click(screen.getByRole("button", {name: "Claude is blocked in 3 more sessions"}));
		const popup = await screen.findByRole("dialog");
		const names = within(popup)
			.getAllByRole("button")
			.map((button) => button.textContent);
		fireEvent.click(within(popup).getByRole("button", {name: /Task 4/}));

		expect({
			dismissed: onDismiss.mock.calls.map(([candidates]) => candidates.map((c) => c.subject)),
			names,
			opened: onOpen.mock.calls,
		}).toStrictEqual({
			dismissed: [["s3", "s4", "s5"]],
			names: [
				"Blocked Task 3Asked a question",
				"Blocked Task 4Needs permission",
				"Blocked Task 5Asked a question",
			],
			opened: [["s4"]],
		});
	});

	it("moves focus to the previous row after a dismiss, else the composer", () => {
		const onDismiss = vi.fn<(candidates: NextStepCandidate[]) => void>();
		render(
			<>
				<NextStepsList rows={rowsOf(3)} onOpen={() => {}} onDismiss={onDismiss} />
				<FakeComposer />
			</>,
		);

		fireEvent.click(screen.getByRole("button", {name: "Dismiss “Task 2”"}));
		const afterSecond = document.activeElement?.textContent;
		fireEvent.click(screen.getByRole("button", {name: "Dismiss “Task 1”"}));

		expect({
			afterSecond,
			afterFirst: document.activeElement?.getAttribute("aria-label"),
			dismissed: onDismiss.mock.calls.map(([candidates]) => candidates.map((c) => c.subject)),
		}).toStrictEqual({
			afterSecond: "Blocked Task 1Asked a question",
			afterFirst: "Prompt",
			dismissed: [["s2"], ["s1"]],
		});
	});

	it("renders nothing without rows", () => {
		const {container} = render(<NextStepsList rows={[]} onOpen={() => {}} onDismiss={() => {}} />);

		expect(container.innerHTML).toBe("");
	});
});
