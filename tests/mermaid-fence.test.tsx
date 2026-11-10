// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {MERMAID_RENDER_FAILED_NOTE, MermaidFence} from "../src/components/mermaid-fence";
import {MermaidPlaceholder} from "../src/components/mermaid-fence-gate";
import type {MermaidStatus} from "../src/components/mermaid-diagram";

const {diagram} = vi.hoisted(() => {
	const state: {report: ((status: MermaidStatus) => void) | undefined; first: MermaidStatus} = {
		report: undefined,
		first: "loading",
	};
	return {diagram: state};
});

// The renderer is covered in mermaid-diagram.test.tsx; here the test decides when it finishes.
vi.mock("../src/components/mermaid-diagram", async () => {
	const {useEffect} = await import("react");
	return {
		MermaidDiagram: ({code, onStatusChange}: {code: string; onStatusChange?: (status: MermaidStatus) => void}) => {
			useEffect(() => {
				diagram.report = onStatusChange;
				onStatusChange?.(diagram.first);
			}, [onStatusChange]);
			return <div data-testid="diagram">{code}</div>;
		},
	};
});

const CODE_BLOCK = <div className="markdown-codeblock">source</div>;

function fence() {
	return render(<MermaidFence code="graph TD; A-->B" codeBlock={CODE_BLOCK} placeholder={<MermaidPlaceholder />} />);
}

function report(status: MermaidStatus) {
	act(() => {
		diagram.report?.(status);
	});
}

function layers(container: HTMLElement) {
	return [...container.querySelectorAll<HTMLElement>("[data-testid=epitaxy-mermaid-fence-layer]")].map((layer) => ({
		layer: layer.dataset["layer"],
		state: layer.dataset["state"],
		hidden: layer.getAttribute("aria-hidden"),
		inert: layer.hasAttribute("inert"),
		className: layer.className,
		holds: layer.firstElementChild?.getAttribute("data-testid") ?? layer.firstElementChild?.className,
	}));
}

const SHOWN = "transition-[opacity,visibility] duration-base ease-out motion-reduce:transition-none relative flow-root";
const HIDDEN =
	"transition-[opacity,visibility] duration-base ease-out motion-reduce:transition-none pointer-events-none invisible absolute inset-x-0 top-0 opacity-0";
const ROOT =
	"relative flex min-w-0 flex-col gap-xs transition-[height] duration-base ease-out motion-reduce:transition-none";

beforeEach(() => {
	vi.useFakeTimers();
	diagram.report = undefined;
	diagram.first = "loading";
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	document.documentElement.removeAttribute("data-reduce-motion");
});

describe("MermaidFence (upstream EpitaxyMermaidFence)", () => {
	it("draws hidden under the placeholder, with no toolbar, until the diagram succeeds", () => {
		const {container} = fence();
		const root = container.firstElementChild as HTMLElement;
		const placeholder = container.querySelector("[data-testid=epitaxy-mermaid-fence-placeholder]");
		expect({
			testId: root.dataset["testid"],
			className: root.className,
			busy: root.getAttribute("aria-busy"),
			layers: layers(container),
			placeholder: placeholder?.innerHTML.replace(/<span class="sr-only">Loading<\/span>/, ""),
			toolbar: container.querySelector("[data-placement]"),
		}).toStrictEqual({
			testId: "epitaxy-mermaid-fence",
			className: ROOT,
			busy: "true",
			layers: [
				{
					layer: "code",
					state: "shown",
					hidden: null,
					inert: false,
					className: SHOWN,
					holds: "epitaxy-mermaid-fence-placeholder",
				},
				{
					layer: "diagram",
					state: "preparing",
					hidden: "true",
					inert: true,
					className: HIDDEN,
					holds: "diagram",
				},
			],
			placeholder: `<div class="rounded-[var(--msg-block-radius,0.5rem)] border-0.5 border p-4"><div data-cds="Skeleton" role="status" class="relative max-w-full overflow-hidden bg-[var(--skeleton-base)] after:absolute after:inset-0 after:animate-[shimmer_2s_linear_infinite] after:bg-[linear-gradient(90deg,transparent,var(--skeleton-sheen),transparent)] motion-reduce:after:hidden h-[88px] w-full rounded-md"></div></div>`,
			toolbar: null,
		});
	});

	it("cross-fades to the diagram, then drops the code layer and shows View source in the corner", () => {
		const {container} = fence();
		report("success");
		const root = container.firstElementChild as HTMLElement;
		expect({
			className: root.className,
			busy: root.getAttribute("aria-busy"),
			layers: layers(container).map(({layer, state, className}) => ({layer, state, className})),
		}).toStrictEqual({
			className: `${ROOT} overflow-y-clip`,
			busy: null,
			layers: [
				{layer: "code", state: "leaving", className: HIDDEN},
				{layer: "diagram", state: "shown", className: `${SHOWN} starting:opacity-0`},
			],
		});

		act(() => {
			vi.advanceTimersByTime(400);
		});
		const toolbar = container.querySelector<HTMLElement>("[data-placement]");
		expect({
			className: root.className,
			layers: layers(container).map(({layer, state, className}) => ({layer, state, className})),
			toolbar: {
				placement: toolbar?.dataset["placement"],
				className: toolbar?.className,
				buttons: [...(toolbar?.querySelectorAll("button") ?? [])].map((button) => [
					button.dataset["testid"],
					button.getAttribute("aria-label"),
				]),
			},
		}).toStrictEqual({
			className: ROOT,
			layers: [{layer: "diagram", state: "shown", className: SHOWN}],
			toolbar: {
				placement: "corner",
				className: "absolute right-1.75 top-1.25 flex gap-0.5",
				buttons: [["epitaxy-mermaid-fence-view", "View source"]],
			},
		});
	});

	it("ends the fade on the leaving layer's opacity transitionend", () => {
		const {container} = fence();
		report("success");
		const leaving = container.querySelector<HTMLElement>("[data-state=leaving]");
		fireEvent.transitionEnd(leaving!, {propertyName: "opacity"});
		expect(layers(container).map(({layer, state}) => [layer, state])).toStrictEqual([["diagram", "shown"]]);
	});

	it("toggles between the source and the diagram", () => {
		const {container} = fence();
		report("success");
		act(() => {
			vi.advanceTimersByTime(400);
		});
		const view = () => container.querySelector<HTMLElement>("[data-testid=epitaxy-mermaid-fence-view]")!;
		fireEvent.click(view());
		expect({
			label: view().getAttribute("aria-label"),
			layers: layers(container).map(({layer, state, holds}) => [layer, state, holds]),
		}).toStrictEqual({
			label: "Preview",
			layers: [
				["code", "shown", "markdown-codeblock"],
				["diagram", "leaving", "diagram"],
			],
		});

		act(() => {
			vi.advanceTimersByTime(400);
		});
		// The remounted renderer finds its drawing in the cache and reports success at once.
		diagram.first = "success";
		fireEvent.click(view());
		expect({
			label: view().getAttribute("aria-label"),
			layers: layers(container).map(({layer, state}) => [layer, state]),
		}).toStrictEqual({
			label: "View source",
			layers: [
				["code", "leaving"],
				["diagram", "shown"],
			],
		});
	});

	it("swaps without a leaving layer under reduced motion", () => {
		document.documentElement.setAttribute("data-reduce-motion", "true");
		const {container} = fence();
		report("success");
		expect(layers(container).map(({layer, state}) => [layer, state])).toStrictEqual([["diagram", "shown"]]);
	});

	it("shows the code block under a note, with no toolbar or diagram, when drawing fails", () => {
		const {container} = fence();
		report("error");
		const root = container.firstElementChild as HTMLElement;
		const note = root.firstElementChild as HTMLElement;
		expect({
			note: [note.localName, note.getAttribute("role"), note.className, note.textContent],
			layers: layers(container).map(({layer, state, holds}) => [layer, state, holds]),
			toolbar: container.querySelector("[data-placement]"),
		}).toStrictEqual({
			note: ["p", "note", "text-footnote text-muted-as-secondary", MERMAID_RENDER_FAILED_NOTE],
			layers: [["code", "shown", "markdown-codeblock"]],
			toolbar: null,
		});
	});

	it("shows a cached diagram instantly, with no fade", () => {
		diagram.first = "success";
		const {container} = fence();
		expect(layers(container).map(({layer, state, className}) => [layer, state, className])).toStrictEqual([
			[
				"diagram",
				"shown",
				"transition-none duration-base ease-out motion-reduce:transition-none relative flow-root",
			],
		]);
	});
});
