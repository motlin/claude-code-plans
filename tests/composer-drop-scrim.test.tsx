// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ComposerDropScrim, useFileDropTarget} from "../src/components/composer-drop-scrim";

const onFileDrop = vi.fn<(files: readonly File[]) => void>();

function Harness({disabled = false}: {disabled?: boolean}) {
	const state = useFileDropTarget({onFileDrop, disabled});
	return (
		<>
			<p data-testid="state">{state}</p>
			{state !== "idle" && <ComposerDropScrim />}
		</>
	);
}

const png = new File([new Uint8Array([1])], "dropped.png", {type: "image/png"});
const files = {dataTransfer: {types: ["Files"], files: [png]}};

function scrim() {
	return document.body.querySelector<HTMLElement>('[data-cds="ChatComposerDropScrim"]');
}

function state() {
	return document.querySelector('[data-testid="state"]')?.textContent;
}

afterEach(() => {
	cleanup();
	onFileDrop.mockReset();
});

describe("page-wide drop scrim", () => {
	it("covers the viewport while files are dragged anywhere on the page, with upstream's layers", () => {
		render(<Harness />);
		const notPrevented = fireEvent.dragOver(document.body, files);
		const root = scrim();
		const frame = root?.querySelector(".inset-3\\.5");

		expect({
			notPrevented,
			state: state(),
			portalParent: root?.parentElement === document.body,
			root: root?.className,
			ariaHidden: root?.getAttribute("aria-hidden"),
			layers: Array.from(root?.children ?? []).map((child) => child.className),
			glow: frame?.firstElementChild?.className,
			icons: Array.from(frame?.querySelectorAll("svg") ?? []).map((svg) => ({
				lucide: svg
					.getAttribute("class")
					?.split(" ")
					.find((c) => c.startsWith("lucide-") && c !== "lucide-icon"),
				wrapper: svg.parentElement?.className,
				size: svg.getAttribute("width"),
				delay: (svg as SVGElement).style.getPropertyValue("--rise-delay"),
			})),
			iconRow: frame?.querySelector("[style]")?.getAttribute("style"),
			label: {
				text: frame?.lastElementChild?.textContent,
				className: frame?.lastElementChild?.className,
			},
		}).toStrictEqual({
			notPrevented: false,
			state: "off-target",
			portalParent: true,
			root: "fixed inset-0 z-[100] pointer-events-none",
			ariaHidden: "true",
			layers: [
				"absolute inset-0 backdrop-blur-[12px] motion-safe:animate-[cds-fade-in_0.15s_cubic-bezier(0.215,0.61,0.355,1)]",
				"absolute inset-0 bg-page opacity-60 motion-safe:animate-[cds-fade-in_0.15s_cubic-bezier(0.215,0.61,0.355,1)]",
				"absolute inset-3.5 flex flex-col items-center justify-center gap-2 rounded-card shadow-[inset_0_0_0_2px_var(--color-fill-accent)] motion-safe:animate-[cds-drop-ring-in_0.15s_cubic-bezier(0.215,0.61,0.355,1)]",
			],
			glow: "absolute inset-0 rounded-[inherit] shadow-[inset_0_0_24px_0_color-mix(in_srgb,var(--color-fill-accent)_20%,transparent)] motion-safe:animate-[cds-fade-in_0.2s_cubic-bezier(0.215,0.61,0.355,1)_0.08s_backwards]",
			icons: [
				{lucide: "lucide-image", wrapper: "-rotate-[14deg]", size: "24", delay: "60ms"},
				{lucide: "lucide-files", wrapper: "-translate-y-3", size: "24", delay: ""},
				{lucide: "lucide-folder", wrapper: "rotate-[14deg]", size: "24", delay: "120ms"},
			],
			iconRow: "color: var(--color-fill-accent);",
			label: {text: "Drop files here", className: "text-body font-medium text-accent-100"},
		});
	});

	it("attaches files dropped anywhere on the page and returns to idle", () => {
		render(<Harness />);
		fireEvent.dragOver(document.body, files);
		const notPrevented = fireEvent.drop(document.body, files);

		expect({notPrevented, calls: onFileDrop.mock.calls, state: state(), scrim: scrim()}).toStrictEqual({
			notPrevented: false,
			calls: [[[png]]],
			state: "idle",
			scrim: null,
		});
	});

	it.each([
		["dragleave to nowhere", () => fireEvent.dragLeave(document.body, {...files, relatedTarget: null})],
		["dragend", () => fireEvent.dragEnd(document.body, files)],
		["pointerdown", () => fireEvent.pointerDown(document.body)],
	])("removes the scrim on %s", (_name, end) => {
		render(<Harness />);
		fireEvent.dragOver(document.body, files);
		const shown = scrim() !== null;
		act(() => {
			end();
		});

		expect({shown, state: state(), scrim: scrim()}).toStrictEqual({shown: true, state: "idle", scrim: null});
	});

	it("ignores drags that carry no files, and stays idle when disabled", () => {
		render(<Harness />);
		const textNotPrevented = fireEvent.dragOver(document.body, {dataTransfer: {types: ["text/plain"], files: []}});
		const textState = state();
		cleanup();
		render(<Harness disabled />);
		const disabledNotPrevented = fireEvent.dragOver(document.body, files);
		fireEvent.drop(document.body, files);

		expect({
			textNotPrevented,
			textState,
			disabledNotPrevented,
			disabledState: state(),
			scrim: scrim(),
			calls: onFileDrop.mock.calls,
		}).toStrictEqual({
			textNotPrevented: true,
			textState: "idle",
			disabledNotPrevented: true,
			disabledState: "idle",
			scrim: null,
			calls: [],
		});
	});
});

describe("several mounted drop targets", () => {
	const first = vi.fn<(files: readonly File[]) => void>();
	const second = vi.fn<(files: readonly File[]) => void>();

	function Target({id, onDrop}: {id: string; onDrop: (files: readonly File[]) => void}) {
		const ref = useRef<HTMLDivElement>(null);
		const dropState = useFileDropTarget({onFileDrop: onDrop, targetRef: ref});
		return (
			<div ref={ref} data-testid={id}>
				<textarea aria-label={id} />
				<span data-testid={`${id}-state`}>{dropState}</span>
				{dropState !== "idle" && <ComposerDropScrim />}
			</div>
		);
	}

	function states() {
		return ["a", "b"].map((id) => document.querySelector(`[data-testid="${id}-state"]`)?.textContent ?? null);
	}

	function dragAndDrop() {
		fireEvent.dragOver(document.body, files);
		const during = {
			states: states(),
			scrims: document.body.querySelectorAll('[data-cds="ChatComposerDropScrim"]').length,
		};
		fireEvent.drop(document.body, files);
		return during;
	}

	afterEach(() => {
		first.mockReset();
		second.mockReset();
	});

	it("routes a page-wide drop to the last-mounted target only, then to whichever target took focus", () => {
		const {rerender} = render(
			<>
				<Target key="a" id="a" onDrop={first} />
				<Target key="b" id="b" onDrop={second} />
			</>,
		);
		const lastMounted = dragAndDrop();
		const afterLastMounted = {first: first.mock.calls.length, second: second.mock.calls.length};

		fireEvent.focusIn(document.querySelector('textarea[aria-label="a"]')!);
		const focused = dragAndDrop();
		const afterFocus = {first: first.mock.calls.length, second: second.mock.calls.length};

		rerender(
			<>
				<Target key="b" id="b" onDrop={second} />
			</>,
		);
		const remaining = dragAndDrop();

		expect({
			lastMounted,
			afterLastMounted,
			focused,
			afterFocus,
			remaining,
			final: {first: first.mock.calls.length, second: second.mock.calls.length},
		}).toStrictEqual({
			lastMounted: {states: ["idle", "off-target"], scrims: 1},
			afterLastMounted: {first: 0, second: 1},
			focused: {states: ["off-target", "idle"], scrims: 1},
			afterFocus: {first: 1, second: 1},
			remaining: {states: [null, "off-target"], scrims: 1},
			final: {first: 1, second: 2},
		});
	});
});
