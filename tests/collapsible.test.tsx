// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import * as Collapsible from "../src/components/ui/collapsible";
import {
	COLLAPSIBLE_CARET_CLASS,
	COLLAPSIBLE_PANEL_CLASS,
	COLLAPSIBLE_TRIGGER_CLASS,
	DISCLOSURE_PANEL_CLASS,
	mergeClassNames,
} from "../src/components/ui/collapsible-classes";
import {useAnimatingAttr} from "../src/components/ui/use-animating-attr";

afterEach(() => {
	cleanup();
});

function Fold(props: {
	rootProps?: Partial<Parameters<typeof Collapsible.Root>[0]>;
	triggerProps?: Partial<Parameters<typeof Collapsible.Trigger>[0]>;
	panelProps?: Partial<Parameters<typeof Collapsible.Panel>[0]>;
}) {
	return (
		<Collapsible.Root {...props.rootProps}>
			<Collapsible.Trigger {...props.triggerProps}>Script</Collapsible.Trigger>
			<Collapsible.Panel {...props.panelProps}>Panel text</Collapsible.Panel>
		</Collapsible.Root>
	);
}

function trigger() {
	return screen.getByRole("button");
}

describe("cds Collapsible", () => {
	it("pins upstream's trigger, caret and panel classes", () => {
		expect({
			trigger: COLLAPSIBLE_TRIGGER_CLASS,
			caret: COLLAPSIBLE_CARET_CLASS,
			panel: COLLAPSIBLE_PANEL_CLASS,
			disclosure: DISCLOSURE_PANEL_CLASS,
		}).toStrictEqual({
			trigger:
				"cds-reset group/clp inline-flex w-fit items-center gap-1.5 border-0 select-none outline-none focus-visible:outline-hidden font-sans text-body font-control-regular text-secondary hover:text-primary transition-shadow duration-[60ms] focus-visible:shadow-focus rounded data-[disabled]:opacity-40 data-[disabled]:pointer-events-none",
			caret: "shrink-0 transition-transform group-data-[panel-open]/clp:rotate-90 group-data-[panel-open]/clp:page-rtl:-rotate-90 motion-reduce:transition-none",
			panel: `${DISCLOSURE_PANEL_CLASS} [--cds-disclosure-panel-height:var(--collapsible-panel-height)]`,
			disclosure:
				"break-words h-[var(--cds-disclosure-panel-height)] transition-[height] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none data-[starting-style]:h-0 data-[ending-style]:h-0 data-[starting-style]:[clip-path:inset(-8px_-100vw_0_-100vw)] data-[ending-style]:[clip-path:inset(-8px_-100vw_0_-100vw)] data-[animating]:[clip-path:inset(-8px_-100vw_0_-100vw)] data-[starting-style]:contain-layout data-[ending-style]:contain-layout data-[animating]:contain-layout",
		});
	});

	it("renders closed by default: data-cds root, collapsed trigger with the filled caret first, no panel", () => {
		const {container} = render(<Fold />);
		const root = container.firstElementChild;
		const button = trigger();
		const caret = button.firstElementChild;

		expect({
			cds: root?.getAttribute("data-cds"),
			closed: root?.hasAttribute("data-closed"),
			expanded: button.getAttribute("aria-expanded"),
			className: button.className,
			caretTag: caret?.tagName.toLowerCase(),
			caretClass: caret?.getAttribute("class"),
			caretIcon: caret?.getAttribute("data-cds"),
			caretFontSize: caret instanceof SVGElement ? caret.style.fontSize : null,
			caretFill: caret?.querySelector("path")?.getAttribute("fill"),
			label: button.textContent,
			panel: screen.queryByText("Panel text"),
		}).toStrictEqual({
			cds: "Collapsible",
			closed: true,
			expanded: "false",
			className: COLLAPSIBLE_TRIGGER_CLASS,
			caretTag: "svg",
			caretClass: COLLAPSIBLE_CARET_CLASS,
			caretIcon: "Icon",
			caretFontSize: "calc(1rem * var(--cds-rem-scale, 1))",
			caretFill: "currentColor",
			label: "Script",
			panel: null,
		});
	});

	it("opens on click: expanded trigger with data-panel-open and aria-controls pointing at the mounted panel", () => {
		render(<Fold />);
		fireEvent.click(trigger());
		const panel = screen.getByText("Panel text");

		expect({
			expanded: trigger().getAttribute("aria-expanded"),
			panelOpen: trigger().hasAttribute("data-panel-open"),
			controls: trigger().getAttribute("aria-controls"),
			panelId: panel.id,
			panelIdSet: panel.id !== "",
		}).toStrictEqual({
			expanded: "true",
			panelOpen: true,
			controls: panel.id,
			panelId: panel.id,
			panelIdSet: true,
		});
	});

	it("starts open with defaultOpen", () => {
		render(<Fold rootProps={{defaultOpen: true}} />);
		expect({
			expanded: trigger().getAttribute("aria-expanded"),
			panel: screen.getByText("Panel text").textContent,
		}).toStrictEqual({expanded: "true", panel: "Panel text"});
	});

	it("puts an end caret last with ms-auto and the half-pixel nudge", () => {
		render(<Fold triggerProps={{caretPosition: "end"}} />);
		const caret = trigger().lastElementChild;
		expect({
			tag: caret?.tagName.toLowerCase(),
			className: caret?.getAttribute("class"),
			translate: caret instanceof SVGElement ? caret.style.translate : null,
		}).toStrictEqual({tag: "svg", className: `${COLLAPSIBLE_CARET_CLASS} ms-auto`, translate: "0 0.5px"});
	});

	it("puts a row-end outline CaretRight last with ms-auto, the stays-secondary ink and no nudge", () => {
		render(<Fold triggerProps={{caretPosition: "row-end"}} />);
		const caret = trigger().lastElementChild;
		expect({
			tag: caret?.tagName.toLowerCase(),
			fill: caret?.getAttribute("fill"),
			lucide: caret?.classList.contains("lucide-chevron-right"),
			tokens: caret?.getAttribute("class")?.split(" ").slice(-7),
			translate: caret instanceof SVGElement ? caret.style.translate : null,
		}).toStrictEqual({
			tag: "svg",
			fill: "none",
			lucide: true,
			tokens: [
				"shrink-0",
				"transition-transform",
				"group-data-[panel-open]/clp:rotate-90",
				"group-data-[panel-open]/clp:page-rtl:-rotate-90",
				"motion-reduce:transition-none",
				"ms-auto",
				"text-[color:var(--cds-text-stays-secondary,var(--color-ink-muted))]",
			],
			translate: "",
		});
	});

	it("draws no caret with hideCaret", () => {
		render(<Fold triggerProps={{hideCaret: true}} />);
		expect(trigger().querySelector("svg")).toBeNull();
	});

	it("renders the caller's element as-is with render: only its className, no caret", () => {
		render(<Fold triggerProps={{render: <button type="button" />, className: "x"}} />);
		expect({className: trigger().className, svg: trigger().querySelector("svg")}).toStrictEqual({
			className: "x",
			svg: null,
		});
	});

	it("merges a caller's size and ink over text-body and text-secondary", () => {
		render(<Fold triggerProps={{className: "text-footnote text-muted-as-secondary"}} />);
		expect(trigger().className).toBe(
			"cds-reset group/clp inline-flex w-fit items-center gap-1.5 border-0 select-none outline-none focus-visible:outline-hidden font-sans font-control-regular hover:text-primary transition-shadow duration-[60ms] focus-visible:shadow-focus rounded data-[disabled]:opacity-40 data-[disabled]:pointer-events-none text-footnote text-muted-as-secondary",
		);
	});

	it("blocks text selection on a double-click mousedown but not a single click", () => {
		render(<Fold />);
		expect({
			double: fireEvent.mouseDown(trigger(), {detail: 2, button: 0}),
			single: fireEvent.mouseDown(trigger(), {detail: 1, button: 0}),
			doubleRight: fireEvent.mouseDown(trigger(), {detail: 2, button: 2}),
		}).toStrictEqual({double: false, single: true, doubleRight: true});
	});

	it("still runs the caller's onMouseDown before the guard", () => {
		const calls: number[] = [];
		render(<Fold triggerProps={{onMouseDown: (event) => calls.push(event.detail)}} />);
		fireEvent.mouseDown(trigger(), {detail: 3, button: 0});
		expect(calls).toStrictEqual([3]);
	});

	it("marks the trigger data-disabled under a disabled root", () => {
		render(<Fold rootProps={{disabled: true}} />);
		expect(trigger().hasAttribute("data-disabled")).toBe(true);
	});

	it("gives the panel upstream's height-animated class, and transition-none removes the height transition", () => {
		const {unmount} = render(<Fold rootProps={{defaultOpen: true}} />);
		const plain = screen.getByText("Panel text").className;
		unmount();
		render(<Fold rootProps={{defaultOpen: true}} panelProps={{className: "transition-none"}} />);
		const tokens = screen.getByText("Panel text").className.split(" ");
		expect({
			plain,
			hasHeight: tokens.includes("transition-[height]"),
			last: tokens.at(-1),
		}).toStrictEqual({plain: COLLAPSIBLE_PANEL_CLASS, hasHeight: false, last: "transition-none"});
	});

	it("keeps a closed panel mounted and hidden with keepMounted, and until-found with hiddenUntilFound", () => {
		const {unmount} = render(<Fold panelProps={{keepMounted: true}} />);
		const kept = screen.getByText("Panel text").hasAttribute("hidden");
		unmount();
		render(<Fold panelProps={{hiddenUntilFound: true}} />);
		expect({kept, untilFound: screen.getByText("Panel text").getAttribute("hidden")}).toStrictEqual({
			kept: true,
			untilFound: "until-found",
		});
	});
});

describe("useAnimatingAttr", () => {
	function Probe() {
		const ref = useAnimatingAttr();
		return <div data-testid="probe" ref={ref} />;
	}

	it("sets data-animating while a starting style is present and clears it when the height transition ends", async () => {
		render(<Probe />);
		const probe = screen.getByTestId("probe");
		const before = probe.hasAttribute("data-animating");

		await act(async () => {
			probe.setAttribute("data-starting-style", "");
			await Promise.resolve();
		});
		const starting = probe.hasAttribute("data-animating");

		await act(async () => {
			probe.removeAttribute("data-starting-style");
			await Promise.resolve();
		});
		probe.dispatchEvent(Object.assign(new Event("transitionrun"), {propertyName: "height"}));
		const running = probe.hasAttribute("data-animating");
		probe.dispatchEvent(Object.assign(new Event("transitionend"), {propertyName: "height"}));

		expect({before, starting, running, after: probe.hasAttribute("data-animating")}).toStrictEqual({
			before: false,
			starting: true,
			running: true,
			after: false,
		});
	});

	it("ignores other properties' transitions", () => {
		render(<Probe />);
		const probe = screen.getByTestId("probe");
		probe.dispatchEvent(Object.assign(new Event("transitionrun"), {propertyName: "opacity"}));
		expect(probe.hasAttribute("data-animating")).toBe(false);
	});
});

describe("mergeClassNames", () => {
	it("keeps the last class of each conflicting group and leaves unrelated classes alone", () => {
		expect({
			size: mergeClassNames("text-body text-secondary", "text-footnote"),
			ink: mergeClassNames("text-body text-secondary hover:text-primary", "text-muted-as-secondary"),
			hover: mergeClassNames("hover:text-primary", "hover:text-secondary"),
			align: mergeClassNames("text-secondary", "text-start"),
			wrap: mergeClassNames("text-secondary", "text-nowrap"),
			transition: mergeClassNames("transition-[height] duration-200", "transition-none"),
			arbitrarySize: mergeClassNames("text-body", "text-[12px]/[15px]"),
			empty: mergeClassNames("a b", undefined),
		}).toStrictEqual({
			size: "text-secondary text-footnote",
			ink: "text-body hover:text-primary text-muted-as-secondary",
			hover: "hover:text-secondary",
			align: "text-secondary text-start",
			wrap: "text-secondary text-nowrap",
			transition: "duration-200 transition-none",
			arbitrarySize: "text-[12px]/[15px]",
			empty: "a b",
		});
	});
});
