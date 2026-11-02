// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {PopoverRoot, PopoverTrigger, PopoverContent} from "../src/components/ui/popover";
import {preloadPopoverSheet} from "../src/components/ui/popover-sheet-loader";

/* The sheet presentation is a lazy chunk; load it once so sheets render synchronously on open. */
beforeAll(async () =>
{
	await preloadPopoverSheet();
});

beforeEach(() =>
{
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => (
		{
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("PopoverContent under a fine pointer", () =>
{
	it("renders the anchored Portal → Positioner → Popup with the consumer className and no sheet chrome", () =>
	{
		render(
			<PopoverRoot>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent side="top" align="end" sideOffset={6} className="w-[360px] rounded-r7 p-3">
					<p>Body</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Usage",
				},
			),
		);
		const popup = screen.getByRole("dialog");
		const positioner = popup.parentElement;
		expect(
			{
				popupClass: popup.className,
				body: popup.textContent,
				positionerClass: positioner?.className,
				side: positioner?.getAttribute("data-side"),
				align: positioner?.getAttribute("data-align"),
				presentation: document.querySelector("[data-presentation]"),
				scrim: document.querySelector("[data-sheet-scrim]"),
				handle: document.querySelector("[data-cds-sheet-handle]"),
				close: document.querySelector("[data-cds-sheet-control]"),
			},
		).toStrictEqual(
			{
				popupClass: "w-[360px] rounded-r7 p-3",
				body: "Body",
				positionerClass: "z-[130]",
				side: "top",
				align: "end",
				presentation: null,
				scrim: null,
				handle: null,
				close: null,
			},
		);
	});

	it("leaves body scroll untouched and the portal unforced, as a non-modal anchored popover", async () =>
	{
		render(
			<PopoverRoot>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent>
					<p>Body</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Usage",
				},
			),
		);
		/* Base UI takes its scroll lock on a zero-delay timeout. */
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 10);
		});
		expect(
			{
				overflow: [document.body.style.overflowX, document.body.style.overflowY],
				portalDensity: screen.getByRole("dialog").parentElement?.parentElement?.getAttribute("data-density"),
			},
		).toStrictEqual(
			{
				overflow: ["", ""],
				portalDensity: null,
			},
		);
	});

	it("stays anchored when structurallyAnchored", () =>
	{
		render(
			<PopoverRoot defaultOpen>
				<PopoverTrigger>Search</PopoverTrigger>
				<PopoverContent structurallyAnchored className="w-80">
					<p>Results</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		expect(
			{
				popupClass: screen.getByRole("dialog").className,
				presentation: document.querySelector("[data-presentation]"),
			},
		).toStrictEqual(
			{
				popupClass: "w-80",
				presentation: null,
			},
		);
	});
});

describe("PopoverContent under a coarse pointer", () =>
{
	function stubCoarseAtWidth(width: number)
	{
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => (
			{
				matches:
					query === "(pointer: coarse)" ||
					(query === "(pointer: coarse) and (max-width: 639.98px)" && width < 640),
				media: query,
				onchange: null,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
				addListener: () => undefined,
				removeListener: () => undefined,
				dispatchEvent: () => false,
			})),
		);
	}

	function renderUsage()
	{
		render(
			<PopoverRoot>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent side="top" align="end" className="w-[360px] max-w-[90vw] rounded-r7 p-3">
					<p>Body</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Usage",
				},
			),
		);
		return screen.getByRole("dialog");
	}

	function classes(element: Element | null | undefined): string[]
	{
		return (element?.getAttribute("class") ?? "").split(" ");
	}

	it("presents a bottom sheet at 420px, as upstream's PopoverSheetContent", () =>
	{
		stubCoarseAtWidth(420);
		const popup = renderUsage();
		const [handle, wrapper] = Array.from(popup.children);
		const scrim = document.querySelector("[data-sheet-scrim]");
		const positioner = popup.parentElement;
		const body = wrapper?.firstElementChild;
		expect(
			{
				attributes:
				{
					cds: popup.getAttribute("data-cds"),
					size: popup.getAttribute("data-size"),
					presentation: popup.getAttribute("data-presentation"),
					depth: popup.getAttribute("data-cds-sheet-depth"),
					detent: popup.getAttribute("data-cds-sheet-detent"),
					treeMatchesScrim: popup.getAttribute("data-sheet-tree") === scrim?.getAttribute("data-sheet-scrim"),
				},
				scrim:
				{
					presentation: scrim?.getAttribute("data-presentation"),
					class: scrim?.className,
				},
				positioner:
				{
					class: positioner?.className,
					position: positioner?.style.position,
					inset: positioner?.style.inset,
					transform: positioner?.style.transform,
				},
				popupClass:
				{
					roundedTop: classes(popup).includes("rounded-t-[14px]"),
					consumerWidth: classes(popup).includes("w-[360px]"),
					consumerPadding: classes(popup).includes("p-3"),
				},
				popupStyle:
				{
					maxHeight: popup.style.maxHeight,
					availableHeight: popup.style.getPropertyValue("--available-height"),
				},
				handle:
				{
					marker: handle?.hasAttribute("data-cds-sheet-handle"),
					ariaHidden: handle?.getAttribute("aria-hidden"),
					class: handle?.className,
					pill: handle?.firstElementChild?.className,
				},
				wrapperClass: wrapper?.className,
				body:
				{
					tabIndex: body?.getAttribute("tabindex"),
					popoverBody: body?.hasAttribute("data-cds-popover-body"),
					scroll: body?.hasAttribute("data-cds-sheet-scroll"),
					class: body?.className,
					text: body?.textContent,
				},
			},
		).toStrictEqual(
			{
				attributes:
				{
					cds: "Popover",
					size: "lg",
					presentation: "sheet",
					depth: "0",
					detent: "default",
					treeMatchesScrim: true,
				},
				scrim:
				{
					presentation: "sheet",
					class: "draggable-none fixed inset-0 bg-backdrop transition-opacity duration-[300ms] ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
				},
				positioner:
				{
					class: "z-[130] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-[100dvh] after:bg-[var(--menu-bg)]",
					position: "fixed",
					inset: "auto 0 0",
					transform: "none",
				},
				popupClass:
				{
					roundedTop: true,
					consumerWidth: false,
					consumerPadding: false,
				},
				popupStyle:
				{
					maxHeight: "calc(0.9 * (100dvh - env(safe-area-inset-top, 0px)))",
					availableHeight: "calc((100dvh - env(safe-area-inset-top,0px)) * .9)",
				},
				handle:
				{
					marker: true,
					ariaHidden: "true",
					class: "flex min-h-8 shrink-0 touch-none items-center justify-center select-none",
					pill: "h-1 w-9 rounded-full bg-border",
				},
				wrapperClass: "flex min-h-0 flex-auto flex-col h-auto max-h-none w-full min-w-0 max-w-none",
				body:
				{
					tabIndex: "-1",
					popoverBody: true,
					scroll: true,
					class: "[display:inherit] [flex-direction:inherit] [flex-wrap:inherit] [align-items:inherit] [justify-content:inherit] [justify-items:inherit] [gap:inherit] [grid-template-columns:inherit] [grid-template-rows:inherit] [grid-auto-flow:inherit] [grid-auto-columns:inherit] [grid-auto-rows:inherit] col-span-full row-span-full self-stretch justify-self-stretch max-h-[inherit] min-h-0 min-w-0 flex-auto overflow-y-auto rounded-[inherit] outline-none focus-visible:outline-hidden p-3",
					text: "Body",
				},
			},
		);
	});

	it("ends the body wrapper with an sr-only Close button that closes the sheet", () =>
	{
		stubCoarseAtWidth(420);
		const onOpenChange = vi.fn<(open: boolean) => void>();
		render(
			<PopoverRoot onOpenChange={onOpenChange}>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent className="w-80">
					<p>Body</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Usage",
				},
			),
		);
		const close = screen.getByRole(
			"button",
			{
				name: "Close",
			},
		);
		const wrapper = screen.getByRole("dialog").children[1];
		const shape =
		{
			type: close.getAttribute("type"),
			control: close.hasAttribute("data-cds-sheet-control"),
			lastChild: wrapper?.lastElementChild === close,
			class: close.className,
		};
		fireEvent.click(close);
		expect(
			{
				shape,
				closes: onOpenChange.mock.calls.map(([open]) => open),
			},
		).toStrictEqual(
			{
				shape:
				{
					type: "button",
					control: true,
					lastChild: true,
					class: "mx-1 mb-1 block min-h-10 shrink-0 rounded-r7 px-2 text-start text-[15px]/[22px] font-normal text-primary outline-none select-none focus-visible:bg-fill-ghost-hover [&:not(:focus-visible):not([data-cds-sheet-control-held])]:sr-only",
				},
				closes: [true, false],
			},
		);
	});

	it("labels the Close button with closeLabel", () =>
	{
		stubCoarseAtWidth(420);
		render(
			<PopoverRoot defaultOpen>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent closeLabel="Dismiss usage">
					<p>Body</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		expect(
			screen
				.getByRole(
					"button",
					{
						name: "Dismiss usage",
					},
				)
				.hasAttribute("data-cds-sheet-control"),
		).toBe(true);
	});

	it("holds a focus-visible Close button visible through a press until the next keydown", () =>
	{
		stubCoarseAtWidth(420);
		render(
			<PopoverRoot defaultOpen>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent>
					<p>Body</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		const popup = screen.getByRole("dialog");
		const close = screen.getByRole(
			"button",
			{
				name: "Close",
			},
		);
		fireEvent.pointerDown(popup);
		const unfocused = close.hasAttribute("data-cds-sheet-control-held");
		vi.spyOn(close, "matches").mockImplementation((selector) => selector.split(", ").includes(":focus-visible"));
		fireEvent.pointerDown(popup);
		const held = close.hasAttribute("data-cds-sheet-control-held");
		fireEvent.keyDown(
			document,
			{
				key: "Shift",
			},
		);
		expect(
			{
				unfocused,
				held,
				released: close.hasAttribute("data-cds-sheet-control-held"),
			},
		).toStrictEqual(
			{
				unfocused: false,
				held: true,
				released: false,
			},
		);
	});

	it("marks the sheet pressed on any press and holds a highlighted Close button, as upstream's _t", () =>
	{
		stubCoarseAtWidth(420);
		render(
			<PopoverRoot defaultOpen>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent>
					<p>Body</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		const popup = screen.getByRole("dialog");
		const close = screen.getByRole(
			"button",
			{
				name: "Close",
			},
		);
		fireEvent.pointerDown(popup);
		const pressed = popup.hasAttribute("data-cds-sheet-pressed");
		fireEvent.keyDown(
			document,
			{
				key: "Shift",
			},
		);
		const released = popup.hasAttribute("data-cds-sheet-pressed");
		close.setAttribute("data-highlighted", "");
		fireEvent.pointerDown(popup);
		expect(
			{
				pressed,
				released,
				highlightedHeld: close.hasAttribute("data-cds-sheet-control-held"),
				scrollPadding: classes(popup).includes(
					"[&[data-cds-sheet-pressed]_[data-cds-sheet-scroll]]:[scroll-padding-block:0px]",
				),
			},
		).toStrictEqual(
			{
				pressed: true,
				released: false,
				highlightedHeld: true,
				scrollPadding: true,
			},
		);
	});

	it("keeps only the top CanvasText border under forced colors, as upstream's qP and Hc", () =>
	{
		stubCoarseAtWidth(420);
		const popup = renderUsage();
		const tokens = [
			"forced-colors:border",
			"forced-colors:border-solid",
			"forced-colors:border-[color:CanvasText]",
			"forced-colors:border-x-0",
			"forced-colors:border-b-0",
		];
		expect(tokens.filter((token) => classes(popup).includes(token))).toStrictEqual(tokens);
	});

	it("stays anchored at 900px", () =>
	{
		stubCoarseAtWidth(900);
		const popup = renderUsage();
		expect(
			{
				popupClass: popup.className,
				presentation: document.querySelector("[data-presentation]"),
				scrim: document.querySelector("[data-sheet-scrim]"),
			},
		).toStrictEqual(
			{
				popupClass: "w-[360px] max-w-[90vw] rounded-r7 p-3",
				presentation: null,
				scrim: null,
			},
		);
	});

	it("stays anchored at 420px when the consumer controls open without onOpenChange", () =>
	{
		stubCoarseAtWidth(420);
		render(
			<PopoverRoot open>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent className="w-80">
					<p>Body</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		expect(
			{
				popupClass: screen.getByRole("dialog").className,
				presentation: document.querySelector("[data-presentation]"),
			},
		).toStrictEqual(
			{
				popupClass: "w-80",
				presentation: null,
			},
		);
	});

	it("presents a sheet at 420px when the consumer controls open with onOpenChange", () =>
	{
		stubCoarseAtWidth(420);
		render(
			<PopoverRoot open onOpenChange={() => undefined}>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent className="w-80">
					<p>Body</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		expect(screen.getByRole("dialog").getAttribute("data-presentation")).toBe("sheet");
	});

	it("stays anchored at 420px when structurallyAnchored", () =>
	{
		stubCoarseAtWidth(420);
		render(
			<PopoverRoot defaultOpen>
				<PopoverTrigger>Search</PopoverTrigger>
				<PopoverContent structurallyAnchored className="w-80">
					<p>Results</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		expect(
			{
				popupClass: screen.getByRole("dialog").className,
				presentation: document.querySelector("[data-presentation]"),
			},
		).toStrictEqual(
			{
				popupClass: "w-80",
				presentation: null,
			},
		);
	});
	it("locks body scroll while the sheet is open and restores it on close, as upstream's modal sheet", async () =>
	{
		stubCoarseAtWidth(420);
		renderUsage();
		const bodyOverflow = () => (
		{
			x: document.body.style.overflowX,
			y: document.body.style.overflowY,
		});
		await waitFor(() =>
		{
			expect(bodyOverflow()).toStrictEqual(
				{
					x: "hidden",
					y: "hidden",
				},
			);
		});
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Close",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				{
					dialog: screen.queryByRole("dialog"),
					overflow: bodyOverflow(),
				},
			).toStrictEqual(
				{
					dialog: null,
					overflow:
					{
						x: "",
						y: "",
					},
				},
			);
		});
	});

	it("forces the sheet portal comfortable and its body text to upstream's lg 15/22", () =>
	{
		stubCoarseAtWidth(420);
		const popup = renderUsage();
		expect(
			{
				portalDensity: popup.parentElement?.parentElement?.getAttribute("data-density"),
				bodyText: ["[--upstream-text-body:15px]", "[--upstream-leading-body:22px]"].every((token) =>
					classes(popup).includes(token),
				),
			},
		).toStrictEqual(
			{
				portalDensity: "comfortable",
				bodyText: true,
			},
		);
	});
});

describe("PopoverContent sheet height pinning", () =>
{
	const observers:
	{
		callback: ResizeObserverCallback;
		targets: Element[];
	}[] = [];

	beforeEach(() =>
	{
		observers.length = 0;
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => (
			{
				matches: query === "(pointer: coarse)" || query === "(pointer: coarse) and (max-width: 639.98px)",
				media: query,
				onchange: null,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
				addListener: () => undefined,
				removeListener: () => undefined,
				dispatchEvent: () => false,
			})),
		);
		vi.stubGlobal(
			"ResizeObserver",
			class
			{
				readonly record:
				{
					callback: ResizeObserverCallback;
					targets: Element[];
				};
				constructor(callback: ResizeObserverCallback)
				{
					this.record =
					{
						callback,
						targets: [],
					};
					observers.push(this.record);
				}
				observe(target: Element)
				{
					this.record.targets.push(target);
				}
				unobserve(target: Element)
				{
					this.record.targets = this.record.targets.filter((observed) => observed !== target);
				}
				disconnect()
				{
					this.record.targets = [];
				}
			},
		);
	});

	function stubHeight(element: Element, height: number, top = 0)
	{
		element.getBoundingClientRect = () =>
			(
			{
				height,
				top,
				bottom: top + height,
			}) as DOMRect;
	}

	function fireResize()
	{
		act(() =>
		{
			for (const observer of observers) observer.callback([], observer as unknown as ResizeObserver);
		});
	}

	it("pins the popup to its measured content height and re-pins when the DismissButton grows", () =>
	{
		render(
			<PopoverRoot>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent>
					<p>Body</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Usage",
				},
			),
		);
		const popup = screen.getByRole("dialog");
		const body = popup.querySelector<HTMLElement>("[data-cds-popover-body]");
		const close = popup.querySelector("[data-cds-sheet-control]");
		if (body === null || close === null) throw new Error("sheet chrome missing");
		stubHeight(popup, 252);
		stubHeight(screen.getByText("Body"), 200, 40);
		Object.defineProperty(
			body,
			"clientHeight",
			{
				configurable: true,
				value: 200,
			},
		);
		fireResize();
		const atRest = popup.style.height;
		/* The DismissButton turning focus-visible takes 44px from the pinned body. */
		Object.defineProperty(
			body,
			"clientHeight",
			{
				configurable: true,
				value: 156,
			},
		);
		fireResize();
		expect(
			{
				atRest,
				focusVisible: popup.style.height,
				observed: [popup, body, close].every((element) =>
					observers.some((observer) => observer.targets.includes(element)),
				),
			},
		).toStrictEqual(
			{
				atRest: "252px",
				focusVisible: "296px",
				observed: true,
			},
		);
	});

	it("caps an unpinned sheet at .9 of the viewport and a pinned one at .95, as upstream's RH", () =>
	{
		render(
			<PopoverRoot>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent>
					<p>Body</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Usage",
				},
			),
		);
		const popup = screen.getByRole("dialog");
		const body = popup.querySelector<HTMLElement>("[data-cds-popover-body]");
		if (body === null) throw new Error("sheet body missing");
		const before =
		{
			height: popup.style.height,
			maxHeight: popup.style.maxHeight,
		};
		stubHeight(popup, 252);
		stubHeight(screen.getByText("Body"), 200, 40);
		Object.defineProperty(
			body,
			"clientHeight",
			{
				configurable: true,
				value: 200,
			},
		);
		fireResize();
		expect(
			{
				before,
				after:
				{
					height: popup.style.height,
					maxHeight: popup.style.maxHeight,
				},
			},
		).toStrictEqual(
			{
				before:
				{
					height: "",
					maxHeight: "calc(0.9 * (100dvh - env(safe-area-inset-top, 0px)))",
				},
				after:
				{
					height: "252px",
					maxHeight: "calc(0.95 * (100dvh - env(safe-area-inset-top, 0px)))",
				},
			},
		);
	});

	it("leaves the height unpinned until the popup has laid out", () =>
	{
		render(
			<PopoverRoot>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent>
					<p>Body</p>
				</PopoverContent>
			</PopoverRoot>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Usage",
				},
			),
		);
		fireResize();
		expect(screen.getByRole("dialog").style.height).toBe("");
	});
});
