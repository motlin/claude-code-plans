// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {Spinner} from "../src/components/ui/spinner";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function snapshot(container: HTMLElement) {
	const spinner = container.querySelector<HTMLElement>("[data-spinner]");
	return {
		spinner: spinner !== null,
		status: container.querySelector("[role=status]")?.className ?? null,
		label: container.querySelector(".sr-only")?.textContent ?? null,
	};
}

describe("Spinner", () => {
	it("renders upstream's cds Spinner ring at once without a delay", () => {
		const {container} = render(<Spinner />);
		const spinner = container.firstElementChild as HTMLElement;
		const [track, arc] = Array.from(spinner.children) as HTMLElement[];
		expect({
			tag: spinner.tagName,
			cds: spinner.getAttribute("data-spinner"),
			hidden: spinner.getAttribute("aria-hidden"),
			classes: spinner.className,
			width: spinner.style.width,
			height: spinner.style.height,
			track: {classes: track?.className, border: track?.getAttribute("style")},
			arc: {classes: arc?.className, style: arc?.getAttribute("style")},
		}).toStrictEqual({
			tag: "SPAN",
			cds: "",
			hidden: "true",
			classes: "relative inline-block shrink-0 align-middle",
			width: "1rem",
			height: "1rem",
			track: {
				classes: "absolute inset-0 rounded-full",
				border: "border: 1.75px solid var(--color-border);",
			},
			arc: {
				classes: "absolute inset-0 rounded-full animate-[spin_1s_linear_infinite] motion-reduce:animate-none",
				style: "background: conic-gradient(transparent 40%, var(--color-ink-muted)); mask: radial-gradient(farthest-side, transparent calc(100% - 1.75px), rgb(0, 0, 0) calc(100% - 1.25px));",
			},
		});
	});

	it("waits for the delay, then mounts the sr-only label 100ms later", () => {
		vi.useFakeTimers();
		const {container} = render(<Spinner delay={150} label="Searching deeper..." />);
		const states = [snapshot(container)];
		act(() => {
			vi.advanceTimersByTime(149);
		});
		states.push(snapshot(container));
		act(() => {
			vi.advanceTimersByTime(1);
		});
		states.push(snapshot(container));
		act(() => {
			vi.advanceTimersByTime(99);
		});
		states.push(snapshot(container));
		act(() => {
			vi.advanceTimersByTime(1);
		});
		states.push(snapshot(container));
		expect(states).toStrictEqual([
			{spinner: false, status: "leading-[0]", label: null},
			{spinner: false, status: "leading-[0]", label: null},
			{spinner: true, status: "leading-[0]", label: null},
			{spinner: true, status: "leading-[0]", label: null},
			{spinner: true, status: "leading-[0]", label: "Searching deeper..."},
		]);
	});
});
