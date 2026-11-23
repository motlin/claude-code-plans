// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {DiagramLightbox} from "../src/components/diagram-lightbox";
import {createDiagramLightboxStore, diagramSize, figureOf} from "../src/lib/diagram-lightbox";

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(attributes: Record<string, string>): SVGSVGElement
{
	const element = document.createElementNS(SVG_NS, "svg");
	for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
	element.innerHTML = "<text>A</text>";
	return element;
}

afterEach(() =>
{
	cleanup();
});

describe("diagramSize (upstream Yu)", () =>
{
	it("reads the viewBox, then the renderer's max-width at 4:3, then falls back to 640×480", () =>
	{
		expect(
			[
				svg(
					{
						viewBox: "0 0 300 120",
					},
				),
				svg(
					{
						viewBox: " 0,0,300,120 ",
					},
				),
				svg(
					{
						viewBox: "0 0 0 120",
						style: "max-width: 500px;",
					},
				),
				svg(
					{
						style: "max-width:212.5px",
					},
				),
				svg({}),
			].map(diagramSize),
		).toStrictEqual([
			{
				width: 300,
				height: 120,
			},
			{
				width: 300,
				height: 120,
			},
			{
				width: 500,
				height: 375,
			},
			{
				width: 212.5,
				height: 159.375,
			},
			{
				width: 640,
				height: 480,
			},
		]);
	});
});

describe("createDiagramLightboxStore (upstream Zu)", () =>
{
	it("keeps the figure while open and drops it on release once closed", () =>
	{
		const store = createDiagramLightboxStore();
		const figure = figureOf(
			svg(
				{
					viewBox: "0 0 10 10",
				},
			),
		);
		store.getState().show(figure);
		store.getState().release();
		const whileOpen = [store.getState().open, store.getState().diagram === figure];
		store.getState().setOpen(false);
		store.getState().release();
		expect([whileOpen, [store.getState().open, store.getState().diagram]]).toStrictEqual([
			[true, true],
			[false, null],
		]);
	});
});

describe("DiagramLightbox (upstream c3fde7009 Zr + qr)", () =>
{
	function open()
	{
		const store = createDiagramLightboxStore();
		render(<DiagramLightbox store={store} />);
		act(() =>
		{
			store.getState().show(
				figureOf(
					svg(
						{
							viewBox: "0 0 400 300",
						},
					),
				),
			);
		});
		return store;
	}

	function stage()
	{
		const region = screen.getByRole(
			"region",
			{
				name: "Diagram, scrolls when larger than the dialog",
			},
		);
		const inner = region.querySelector<HTMLElement>("[data-testid=document-diagram-stage]")!;
		return {
			region,
			inner,
			width: inner.style.width,
			maxWidth: inner.style.maxWidth,
		};
	}

	function zoom(name: "Zoom in" | "Zoom out" | "Reset zoom", times = 1)
	{
		for (let index = 0; index < times; index++)
		{
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name,
					},
				),
			);
		}
		return stage().width;
	}

	it("renders nothing until a diagram is shown", () =>
	{
		render(<DiagramLightbox store={createDiagramLightboxStore()} />);
		expect(document.body.innerHTML).toBe("<div></div>");
	});

	it("shows the copy at fit size under a Diagram header with the zoom group", () =>
	{
		open();
		const dialog = screen.getByRole("dialog");
		const group = screen.getByRole(
			"group",
			{
				name: "Diagram zoom",
			},
		);
		const {region, inner} = stage();
		const shadow = inner.shadowRoot!;
		expect(
			{
				popup: dialog.className
					.split(" ")
					.filter((name) => /^(epitaxy-root|w-|min-w-|max-w-|break-words)/.test(name)),
				title: dialog.querySelector(".sr-only")?.textContent,
				group:
				{
					className: group.className,
					cds: group.dataset["cds"],
				},
				zoom: [...group.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")),
				zoomClass: group.querySelector("button")?.className,
				region:
				{
					tabIndex: region.tabIndex,
					className: region.className,
					style: region.getAttribute("style"),
				},
				inner:
				{
					className: inner.className,
					style: inner.getAttribute("style"),
				},
				shadow: [...shadow.children].map((child) => child.localName),
				sheet: shadow.firstElementChild?.textContent,
				drawing: shadow.lastElementChild?.outerHTML,
			},
		).toStrictEqual(
			{
				popup: ["epitaxy-root", "w-max", "min-w-[min(720px,90vw)]", "max-w-[90vw]", "break-words"],
				title: "Diagram",
				group:
				{
					className: "relative inline-flex w-fit shrink-0 items-stretch gap-xs",
					cds: "ButtonGroup",
				},
				zoom: ["Zoom out", "Reset zoom", "Zoom in"],
				zoomClass:
					"flex shrink-0 items-center justify-center text-primary transition-colors hover:bg-fill-ghost-hover stacks:hover:bg-fill-button-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus aspect-square size-8 panels-fine:size-7 rounded-r6",
				region:
				{
					tabIndex: 0,
					className:
						"hide-focus-ring mx-auto min-h-0 shrink overflow-auto rounded focus-visible:shadow-focus focus-visible:outline-hidden",
					style: "width: 400px; max-width: 100%; aspect-ratio: 400 / 300;",
				},
				inner:
				{
					className: "relative mx-auto [contain:paint]",
					style: "width: 400px; max-width: 100%;",
				},
				shadow: ["style", "svg"],
				sheet: ":host > svg { display: block; width: 100% !important; max-width: none !important; height: auto !important; }",
				drawing: `<svg viewBox="0 0 400 300"><text>A</text></svg>`,
			},
		);
	});

	it("zooms by 1.25 a step between min(0.25, fit) and 8, and resets to fit", () =>
	{
		open();
		expect(
			{
				inTwice: zoom("Zoom in", 2),
				maxWidth: stage().maxWidth,
				reset: [zoom("Reset zoom"), stage().maxWidth],
				floor: zoom("Zoom out", 12),
				ceiling: zoom("Zoom in", 30),
			},
		).toStrictEqual(
			{
				inTwice: "625px",
				maxWidth: "",
				reset: ["400px", "100%"],
				floor: "100px",
				ceiling: "3200px",
			},
		);
	});

	it("zooms on Ctrl/⌘+wheel by exp(-deltaY/240) and leaves a plain wheel alone", () =>
	{
		open();
		const {region} = stage();
		fireEvent.wheel(
			region,
			{
				deltaY: 240,
			},
		);
		const plain = stage().width;
		fireEvent.wheel(
			region,
			{
				deltaY: -240,
				ctrlKey: true,
			},
		);
		const ctrl = stage().width;
		fireEvent.wheel(
			region,
			{
				deltaY: 240,
				metaKey: true,
			},
		);
		// 400 × e = 1087.3127…px, which the style declaration keeps to two places.
		expect([plain, ctrl, stage().width]).toStrictEqual(["400px", "1087.31px", "400px"]);
	});

	it("closes on Escape and releases the figure once the close finishes", async () =>
	{
		const store = open();
		fireEvent.keyDown(
			screen.getByRole("dialog"),
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect([store.getState().open, store.getState().diagram, screen.queryByRole("dialog")]).toStrictEqual([
				false,
				null,
				null,
			]);
		});
	});
});
