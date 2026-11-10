// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {MermaidFence} from "../src/components/mermaid-fence";
import {MermaidPlaceholder} from "../src/components/mermaid-fence-gate";
import type {MermaidStatus} from "../src/components/mermaid-diagram";

const {diagram} = vi.hoisted(() => {
	const state: {
		report: ((status: MermaidStatus) => void) | undefined;
		first: MermaidStatus;
		host: HTMLElement | null;
	} = {report: undefined, first: "loading", host: null};
	return {diagram: state};
});

const SVG_NS = "http://www.w3.org/2000/svg";
const CLEAN_SVG = `<svg xmlns="${SVG_NS}"><text>A</text><text>B</text></svg>`;
/** Two labels that join into one fake GitHub token, which upstream's audit reads across the seam. */
const SPLIT_SECRET_SVG = `<svg xmlns="${SVG_NS}"><text>ghp_${"x".repeat(16)}</text><text>${"x".repeat(20)}</text></svg>`;

// The renderer is covered in mermaid-diagram.test.tsx; here the test decides when it finishes and what it drew.
vi.mock("../src/components/mermaid-diagram", async () => {
	const {useEffect, useRef} = await import("react");
	return {
		MermaidDiagram: ({onStatusChange}: {code: string; onStatusChange?: (status: MermaidStatus) => void}) => {
			const host = useRef<HTMLDivElement>(null);
			useEffect(() => {
				diagram.report = onStatusChange;
				diagram.host = host.current;
				if (diagram.first === "success" && host.current) host.current.innerHTML = CLEAN_SVG;
				onStatusChange?.(diagram.first);
			}, [onStatusChange]);
			return <div ref={host} data-testid="diagram" />;
		},
	};
});

const CODE_BLOCK = <div className="markdown-codeblock">source</div>;

function fence() {
	return render(<MermaidFence code="graph TD; A-->B" codeBlock={CODE_BLOCK} placeholder={<MermaidPlaceholder />} />);
}

/** The renderer finishing with `status`; a success first draws `svg` into its host, as the real one does. */
function report(status: MermaidStatus, svg = CLEAN_SVG) {
	act(() => {
		if (status === "success" && diagram.host) diagram.host.innerHTML = svg;
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
	diagram.host = null;
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

	it("draws the toolbar's toggle as upstream's cds ghost icon-only Button with its label as a tooltip", () => {
		const {container} = fence();
		report("success");
		act(() => {
			vi.advanceTimersByTime(400);
		});
		const button = container.querySelector<HTMLElement>("[data-testid=epitaxy-mermaid-fence-view]")!;
		fireEvent.pointerEnter(button.parentElement!);
		act(() => {
			vi.advanceTimersByTime(300);
		});
		expect({
			type: button.getAttribute("type"),
			cds: button.dataset["cds"],
			ghost: button.getAttribute("data-cds-ghost"),
			iconOnly: button.getAttribute("data-cds-icon-only"),
			cssTooltip: button.getAttribute("data-tooltip"),
			className: button.className,
			icon: button.querySelector("svg")?.getAttribute("aria-hidden"),
			tooltip: screen.getByRole("tooltip").textContent,
		}).toStrictEqual({
			type: "button",
			cds: "Button",
			ghost: "",
			iconOnly: "",
			cssTooltip: null,
			className:
				"inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 border-0 bg-transparent p-0 text-t6 hover:bg-[hsl(0_0%_4.3137%_/_0.06)] hover:text-primary dark:hover:bg-[hsl(0_0%_100%_/_0.08)] [&_svg]:size-4",
			icon: "true",
			tooltip: "View source",
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
			// Upstream GVQKxz (current c9e4d0c57), shown on every render error.
			note: [
				"p",
				"note",
				"text-footnote text-muted-as-secondary",
				"This diagram couldn\u2019t be drawn. Showing its source.",
			],
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

	it("withholds a drawing whose labels split a secret: the code block shows at once, with no diagram, note or toolbar", () => {
		const {container} = fence();
		report("success", SPLIT_SECRET_SVG);
		const root = container.firstElementChild as HTMLElement;
		expect({
			className: root.className,
			busy: root.getAttribute("aria-busy"),
			layers: layers(container).map(({layer, state, holds}) => [layer, state, holds]),
			svgs: container.querySelectorAll("svg").length,
			note: container.querySelector("[role=note]"),
			toolbar: container.querySelector("[data-placement]"),
		}).toStrictEqual({
			className: ROOT,
			busy: null,
			layers: [["code", "shown", "markdown-codeblock"]],
			svgs: 0,
			note: null,
			toolbar: null,
		});
	});

	it("withholds a shown diagram once a secret is written into its drawing", async () => {
		const {container} = fence();
		report("success");
		act(() => {
			vi.advanceTimersByTime(400);
		});
		await act(async () => {
			const label = document.createElementNS(SVG_NS, "text");
			label.textContent = `ghp_${"x".repeat(36)}`;
			container.querySelector("svg")!.append(label);
			await Promise.resolve();
		});
		expect({
			layers: layers(container).map(({layer, state, holds}) => [layer, state, holds]),
			svgs: container.querySelectorAll("svg").length,
			note: container.querySelector("[role=note]"),
			toolbar: container.querySelector("[data-placement]"),
		}).toStrictEqual({
			layers: [["code", "shown", "markdown-codeblock"]],
			svgs: 0,
			note: null,
			toolbar: null,
		});
	});
});
