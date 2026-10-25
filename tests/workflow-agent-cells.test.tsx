// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {WorkflowAgentCells} from "../src/components/workflow-agent-cells";
import type {WorkflowProgressCounts} from "../src/lib/workflow-progress";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

const zero: WorkflowProgressCounts = {done: 0, running: 0, stalled: 0, error: 0, stopped: 0, pending: 0, total: 0};
const LIVE: WorkflowProgressCounts = {...zero, done: 1, running: 2, total: 3};

function grid(container: HTMLElement): HTMLElement {
	const element = container.querySelector<HTMLElement>('[role="img"]');
	if (element === null) throw new Error("no agent grid");
	return element;
}

function cell(container: HTMLElement, id: string): HTMLElement {
	const element = container.querySelector<HTMLElement>(`[data-cell="${id}"]`);
	if (element === null) throw new Error(`no cell ${id}`);
	return element;
}

/** Hovers the grid, moves onto `target` and waits out the 150ms open delay. */
function hover(container: HTMLElement, target: HTMLElement): string | null | undefined {
	vi.useFakeTimers();
	const anchor = grid(container).parentElement ?? grid(container);
	fireEvent.pointerEnter(anchor);
	fireEvent.pointerMove(target);
	act(() => {
		vi.advanceTimersByTime(149);
	});
	const early = screen.queryByRole("tooltip");
	act(() => {
		vi.advanceTimersByTime(1);
	});
	if (early !== null) throw new Error("tooltip opened before 150ms");
	return screen.queryByRole("tooltip")?.textContent;
}

describe("WorkflowAgentCells", () => {
	it("draws the live 1 of 3 done, 2 running card grid exactly as upstream", () => {
		const {container} = render(<WorkflowAgentCells counts={LIVE} wrap maxRows={8} anticipate />);

		expect(grid(container).parentElement?.className).toBe("relative flex w-full");
		expect(grid(container).outerHTML).toBe(
			'<span role="img" aria-label="1 of 3 agents done, 2 running, 0 stalled, 0 failed" class="grid w-full overflow-hidden" style="grid-template-columns: repeat(auto-fill, 6px); gap: 2px; max-height: 62px;">' +
				'<span data-cell="0" class="epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--done" style="width: 6px; height: 6px;"></span>' +
				'<span data-cell="1" class="epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--running" style="width: 6px; height: 6px; --epitaxy-pulse-dur: 3.46s; --epitaxy-pulse-delay: -2.14s;"></span>' +
				'<span data-cell="2" class="epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--running" style="width: 6px; height: 6px; --epitaxy-pulse-dur: 3.11s; --epitaxy-pulse-delay: -0.74s;"></span>' +
				'<span data-cell="ghost" class="epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--ghost" style="width: 6px; height: 6px;"></span>' +
				"</span>",
		);
	});

	it("lays out a phase grid in fixed columns, fit to its cells and never capped", () => {
		const {container} = render(<WorkflowAgentCells counts={{...zero, done: 40, total: 40}} wrap cols={16} />);

		expect({
			className: grid(container).className,
			style: grid(container).getAttribute("style"),
			cells: container.querySelectorAll("[data-cell]").length,
		}).toStrictEqual({
			className: "grid w-fit",
			style: "grid-template-columns: repeat(16, 6px); gap: 2px;",
			cells: 40,
		});
	});

	it("drops the height cap for an unbounded wrapping grid", () => {
		const {container} = render(<WorkflowAgentCells counts={LIVE} wrap maxRows={Number.POSITIVE_INFINITY} />);

		expect(grid(container).getAttribute("style")).toBe("grid-template-columns: repeat(auto-fill, 6px); gap: 2px;");
	});

	it("draws a single-row grid inside a body-leading flex box", () => {
		const {container} = render(<WorkflowAgentCells counts={LIVE} />);
		const inner = grid(container).firstElementChild as HTMLElement;

		expect({
			className: grid(container).className,
			style: grid(container).getAttribute("style"),
			innerClass: inner.className,
			innerStyle: inner.getAttribute("style"),
			cells: inner.querySelectorAll("[data-cell]").length,
		}).toStrictEqual({
			className: "flex items-center",
			style: "height: var(--text-body--line-height);",
			innerClass: "grid w-full overflow-hidden",
			innerStyle: "grid-template-columns: repeat(auto-fill, 6px); gap: 2px; max-height: 6px;",
			cells: 3,
		});
	});

	it("colours cells per agent, in agent order, when every agent is known", () => {
		const {container} = render(
			<WorkflowAgentCells
				counts={LIVE}
				wrap
				agents={[
					{label: "Explore a", state: "running"},
					{label: "Explore b", state: "done"},
					{label: "Explore c", state: "running"},
				]}
			/>,
		);

		expect([...container.querySelectorAll("[data-cell]")].map((element) => element.className)).toStrictEqual([
			"epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--running",
			"epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--done",
			"epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--running",
		]);
	});

	it("tips a hovered cell with its state and agent label after 150ms", () => {
		const {container} = render(
			<WorkflowAgentCells
				counts={LIVE}
				wrap
				anticipate
				agents={[
					{label: "Explore a", state: "done"},
					{label: "Explore b", state: "running"},
					{label: "Explore c", state: "pending"},
				]}
			/>,
		);

		expect(hover(container, cell(container, "1"))).toBe("Running Explore b");
	});

	it("tips the ghost cell with More agents may appear", () => {
		const {container} = render(<WorkflowAgentCells counts={LIVE} wrap anticipate />);

		expect(hover(container, cell(container, "ghost"))).toBe("More agents may appear");
	});

	it("tips a sampled cell with only its state label", () => {
		const {container} = render(<WorkflowAgentCells counts={{...zero, pending: 1, total: 1}} wrap />);

		expect(hover(container, cell(container, "0"))).toBe("Queued");
	});

	it("tips the grid between cells with the summary", () => {
		const {container} = render(<WorkflowAgentCells counts={LIVE} wrap />);

		expect(hover(container, grid(container))).toBe("1 of 3 agents done, 2 running, 0 stalled, 0 failed");
	});
});

describe("agent cell CSS", () => {
	const css = readFileSync("src/styles/globals.css", "utf8");

	it("ports upstream's cell states onto the local tokens", () => {
		const rules = [
			".epitaxy-agent-cell {\n\tbackground-color: transparent;\n\tborder: 1px solid transparent;\n\ttransition:\n\t\tbackground-color 0.16s,\n\t\tborder-color 0.16s,\n\t\topacity 0.16s,\n\t\tfilter 0.16s;\n}",
			".epitaxy-agent-cell:hover {\n\tfilter: brightness(0.9);\n}",
			".dark .epitaxy-agent-cell:hover {\n\tfilter: brightness(1.1);\n}",
			".epitaxy-agent-cell--done {\n\tbackground-color: var(--color-alpha-3);\n}",
			".epitaxy-agent-cell--running {\n\tbackground-color: var(--color-fill-accent);\n\tanimation: epitaxy-agent-pulse var(--epitaxy-pulse-dur, 2.8s) ease-in-out var(--epitaxy-pulse-delay, 0s) infinite;\n}",
			".epitaxy-agent-cell--stalled {\n\tbackground-color: var(--upstream-fill-warning);\n}",
			".epitaxy-agent-cell--error {\n\tbackground-color: var(--color-fill-danger);\n}",
			".epitaxy-agent-cell--stopped,\n.epitaxy-agent-cell--pending {\n\tborder-color: var(--color-alpha-3);\n}",
			".epitaxy-agent-cell--ghost {\n\tborder-color: var(--color-alpha-3);\n\tanimation: 2.2s ease-in-out infinite epitaxy-agent-ghost-pulse;\n}",
			"@keyframes epitaxy-agent-pulse {\n\t0%,\n\t100% {\n\t\topacity: 1;\n\t}\n\t50% {\n\t\topacity: 0.72;\n\t}\n}",
			"@keyframes epitaxy-agent-ghost-pulse {\n\t0%,\n\t100% {\n\t\topacity: 0.25;\n\t}\n\t50% {\n\t\topacity: 0.9;\n\t}\n}",
		];

		expect(rules.filter((rule) => !css.includes(rule))).toStrictEqual([]);
	});

	it("stops both animations and parks the ghost at .45 under reduced motion", () => {
		expect(css).toContain(
			"@media (prefers-reduced-motion: reduce) {\n\t.epitaxy-agent-cell {\n\t\ttransition: none;\n\t}\n\t.epitaxy-agent-cell--running {\n\t\tanimation: none;\n\t}\n\t.epitaxy-agent-cell--ghost {\n\t\topacity: 0.45;\n\t\tanimation: none;\n\t}\n}",
		);
	});
});
