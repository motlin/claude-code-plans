// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
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
			{
				text: "Blocked Task 1Asked a question",
				status: "Blocked",
				dismiss: "Dismiss “Task 1”",
			},
			{
				text: "Blocked Task 2Needs permission",
				status: "Blocked",
				dismiss: "Dismiss “Task 2”",
			},
		]);
		const dismissClass = screen
			.getByRole("button", {name: "Dismiss “Task 1”"})
			.parentElement!.parentElement!.className.split(" ");
		expect(
			["opacity-0", "pointer-coarse:opacity-100", "[@media(hover:none)]:opacity-100"].map((token) =>
				dismissClass.includes(token),
			),
		).toStrictEqual([true, true, true]);
	});

	it("uses upstream's row recipe: keyed li, group/row wrapper, reveal-only spacer and dismiss slot", () => {
		const {container} = render(<NextStepsList rows={rowsOf(1)} onOpen={() => {}} onDismiss={() => {}} />);

		const item = container.querySelector("li")!;
		const wrapper = item.firstElementChild!;
		const button = item.querySelector("[data-next-step-open]")!;
		const line = button.querySelector("[data-next-step-line]")!;
		const [title, detail] = [...line.children];
		const dismiss = item.querySelector("[data-next-step-dismiss]")!;
		expect({
			key: item.dataset["rowKey"],
			list: container.querySelector("ul")!.className,
			wrapper: wrapper.className,
			button: button.className,
			inner: line.parentElement!.className,
			line: line.className,
			title: title?.className,
			detail: detail?.className,
			spacer: button.querySelector("[data-next-step-spacer]")?.outerHTML,
			slot: dismiss.parentElement!.parentElement!.className,
			dismiss: dismiss.className,
		}).toStrictEqual({
			key: "waiting-session:s1",
			list: "card-ring flex w-80 max-w-full shrink-0 flex-col rounded-card bg-surface-1 gap-0.5 p-1 [[data-start-card-setup-hidden]_&]:hidden",
			wrapper: "group/row relative",
			button: "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-start text-[13px]/5 outline-none group-hover/row:bg-fill-ghost-hover group-has-[:focus-visible]/row:bg-fill-ghost-hover group-has-[[aria-expanded=true]]/row:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden",
			inner: "flex min-w-0 flex-1 items-center gap-1",
			line: "flex h-5 min-w-0 items-baseline gap-x-2 overflow-hidden whitespace-nowrap flex-wrap",
			title: "min-w-0 max-w-full truncate text-secondary",
			detail: "min-w-0 max-w-max grow basis-24 truncate text-ink-muted group-hover/row:text-secondary group-has-[:focus-visible]/row:text-secondary group-has-[[aria-expanded=true]]/row:text-secondary",
			spacer: '<span aria-hidden="true" data-next-step-spacer="true" class="hidden shrink-0 items-center group-hover/row:flex group-has-[:focus-visible]/row:flex group-has-[[aria-expanded=true]]/row:flex touch:flex -ms-2"><span class="w-6"></span></span>',
			slot: "pointer-events-none absolute inset-y-0 end-1 flex items-center opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 group-has-[[aria-expanded=true]]/row:opacity-100 pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto",
			dismiss:
				"pointer-events-auto flex size-6 items-center justify-center rounded-r5 text-primary hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus",
		});
	});

	it("keys the rest row blocked-sessions", () => {
		const {container} = render(<NextStepsList rows={rowsOf(5)} onOpen={() => {}} onDismiss={() => {}} />);

		expect([...container.querySelectorAll("li")].map((li) => li.dataset["rowKey"])).toStrictEqual([
			"waiting-session:s1",
			"waiting-session:s2",
			"blocked-sessions",
		]);
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
		fireEvent.click(
			screen.getByRole("button", {
				name: "Claude is blocked in 3 more sessions",
			}),
		);
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

	it("opens a start-aligned stacked title + detail tooltip above a row, described by a hidden title span", () => {
		vi.useFakeTimers();
		try {
			const {container} = render(<NextStepsList rows={rowsOf(1)} onOpen={() => {}} onDismiss={() => {}} />);
			const button = container.querySelector<HTMLButtonElement>("[data-next-step-open]")!;
			const describedBy = button.getAttribute("aria-describedby");
			const target = describedBy === null ? null : document.getElementById(describedBy);

			fireEvent.pointerEnter(button.parentElement!);
			act(() => {
				vi.advanceTimersByTime(300);
			});
			const tooltip = screen.getByRole("tooltip");

			expect({
				target: target?.outerHTML.replace(/id="[^"]+"/, 'id=""'),
				side: tooltip.dataset["side"],
				align: tooltip.dataset["align"],
				parts: [...tooltip.children].map((child) => child.textContent),
				stacked: tooltip.className.includes("max-w-[min(480px,calc(100vw-16px))]"),
				startEdge: tooltip.className.split(" ").includes("left-0"),
			}).toStrictEqual({
				target: '<span id="" hidden="">Task 1</span>',
				side: "top",
				align: "start",
				parts: ["Task 1", "Asked a question"],
				stacked: true,
				startEdge: true,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("shows a centred Dismiss tooltip over the X and no tooltip on the rest row", () => {
		vi.useFakeTimers();
		try {
			const {container} = render(<NextStepsList rows={rowsOf(5)} onOpen={() => {}} onDismiss={() => {}} />);
			const rest = screen.getByRole("button", {name: "Claude is blocked in 3 more sessions"});

			fireEvent.pointerEnter(rest);
			fireEvent.focus(rest);
			act(() => {
				vi.advanceTimersByTime(300);
			});
			const restTooltips = screen.queryAllByRole("tooltip").length;
			fireEvent.blur(rest);
			fireEvent.pointerLeave(rest);

			const dismiss = container.querySelector("li [data-next-step-dismiss]")!;
			fireEvent.pointerEnter(dismiss.parentElement!);
			act(() => {
				vi.advanceTimersByTime(300);
			});
			const tooltip = screen.getByRole("tooltip");

			expect({
				restTooltips,
				text: tooltip.textContent,
				side: tooltip.dataset["side"],
				align: tooltip.dataset["align"],
			}).toStrictEqual({restTooltips: 0, text: "Dismiss", side: "top", align: "center"});
		} finally {
			vi.useRealTimers();
		}
	});

	it("renders nothing without rows", () => {
		const {container} = render(<NextStepsList rows={[]} onOpen={() => {}} onDismiss={() => {}} />);

		expect(container.innerHTML).toBe("");
	});
});
