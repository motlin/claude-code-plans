// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SplitDropdownButton, type SplitItem} from "../src/components/ui/split-dropdown-button";
import {compileAll, loadDesignSystem} from "./helpers/tailwind-design-system";

afterEach(() =>
{
	cleanup();
});

async function flush()
{
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
}

function group()
{
	return screen.getByRole(
		"group",
		{
			name: "Always allow",
		},
	);
}

function primary()
{
	return screen.getByRole(
		"button",
		{
			name: "Always allow",
		},
	);
}

function caret()
{
	return screen.getByRole(
		"button",
		{
			name: "More allow options",
		},
	);
}

function renderSplit(
	props: Partial<Parameters<typeof SplitDropdownButton>[0]> = {},
	items: SplitItem[] = [
		{
			label: "Allow once",
			onSelect: () =>
			{
			},
		},
	],
)
{
	const onPrimaryClick = vi.fn<() => void>();
	const view = render(
		<SplitDropdownButton
			label="Always allow"
			menuLabel="More allow options"
			items={items}
			onPrimaryClick={onPrimaryClick}
			{...props}
		/>,
	);
	return {
		onPrimaryClick,
		...view,
	};
}

async function openByClick()
{
	fireEvent.click(caret());
	await flush();
	return screen.getByRole("menu");
}

describe("SplitDropdownButton", () =>
{
	it("renders a named group with the primary and the menu caret", () =>
	{
		renderSplit();

		expect(
			{
				cds: group().getAttribute("data-cds"),
				popupOpen: group().hasAttribute("data-popup-open"),
				buttons: screen
					.getAllByRole("button")
					.map((button) => button.getAttribute("aria-label") ?? button.textContent),
				haspopup: caret().getAttribute("aria-haspopup"),
				expanded: caret().getAttribute("aria-expanded"),
				primaryType: primary().getAttribute("type"),
				caretType: caret().getAttribute("type"),
				caretIconOnly: caret().hasAttribute("data-cds-icon-only"),
			},
		).toStrictEqual(
			{
				cds: "SplitDropdownButton",
				popupOpen: false,
				buttons: ["Always allow", "More allow options"],
				haspopup: "menu",
				expanded: "false",
				primaryType: "button",
				caretType: "button",
				caretIconOnly: true,
			},
		);
	});

	it("names the group from aria-label for an icon-only primary", () =>
	{
		render(
			<SplitDropdownButton
				icon={<span>↵</span>}
				aria-label="Send"
				menuLabel="More send options"
				items={[]}
				onPrimaryClick={() =>
				{
				}}
			/>,
		);

		expect(screen.getByRole("group").getAttribute("aria-label")).toBe("Send");
		expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toStrictEqual([
			"Send",
			"More send options",
		]);
	});

	it("opens the menu from the caret with items in order and a separator before separatorBefore", async () =>
	{
		renderSplit({}, [
			{
				label: "Allow once",
				onSelect: () =>
				{
				},
			},
			"separator",
			{
				label: "Deny",
				onSelect: () =>
				{
				},
				separatorBefore: true,
			},
		]);

		await openByClick();

		expect(
			{
				popupOpen: group().getAttribute("data-popup-open"),
				expanded: caret().getAttribute("aria-expanded"),
				items: screen.getAllByRole("menuitem").map((item) => item.textContent),
				separators: screen.getAllByRole("separator").length,
			},
		).toStrictEqual(
			{
				popupOpen: "",
				expanded: "true",
				items: ["Allow once", "Deny"],
				separators: 2,
			},
		);
	});

	it("calls an item's onSelect once and closes the menu", async () =>
	{
		const onSelect = vi.fn<() => void>();
		renderSplit({}, [
			{
				label: "Allow once",
				onSelect,
			},
		]);
		await openByClick();

		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Allow once",
				},
			),
		);
		await flush();

		expect(
			{
				calls: onSelect.mock.calls.length,
				menu: screen.queryByRole("menu"),
				popupOpen: group().hasAttribute("data-popup-open"),
			},
		).toStrictEqual(
			{
				calls: 1,
				menu: null,
				popupOpen: false,
			},
		);
	});

	it("closes the menu without firing the primary when the primary is clicked while open", async () =>
	{
		const {onPrimaryClick} = renderSplit();
		await openByClick();

		fireEvent.pointerDown(primary());
		fireEvent.click(primary());
		await flush();

		expect(
			{
				calls: onPrimaryClick.mock.calls.length,
				menu: screen.queryByRole("menu"),
			},
		).toStrictEqual(
			{
				calls: 0,
				menu: null,
			},
		);

		fireEvent.click(primary());
		expect(onPrimaryClick.mock.calls.length).toBe(1);
	});

	it("opens with the first item highlighted on Enter and returns focus to the caret on Escape", async () =>
	{
		renderSplit({}, [
			{
				label: "Allow once",
				onSelect: () =>
				{
				},
			},
			{
				label: "Deny",
				onSelect: () =>
				{
				},
			},
		]);
		caret().focus();

		/* jsdom does not synthesize the click a real Enter on a button fires, so send both. */
		fireEvent.keyDown(
			caret(),
			{
				key: "Enter",
			},
		);
		fireEvent.click(
			caret(),
			{
				detail: 0,
			},
		);
		fireEvent.keyUp(
			caret(),
			{
				key: "Enter",
			},
		);
		await flush();
		const first = screen.getByRole(
			"menuitem",
			{
				name: "Allow once",
			},
		);

		expect(first.getAttribute("data-highlighted")).toBe("");

		fireEvent.keyDown(
			document.activeElement as HTMLElement,
			{
				key: "Escape",
			},
		);
		await flush();

		expect(
			{
				menu: screen.queryByRole("menu"),
				focusedCaret: document.activeElement === caret(),
			},
		).toStrictEqual(
			{
				menu: null,
				focusedCaret: true,
			},
		);
	});

	it("marks a busy primary aria-busy and aria-disabled and ignores its click", () =>
	{
		const {onPrimaryClick} = renderSplit(
			{
				busy: true,
			},
		);

		fireEvent.click(primary());

		expect(
			{
				busy: primary().getAttribute("aria-busy"),
				ariaDisabled: primary().getAttribute("aria-disabled"),
				calls: onPrimaryClick.mock.calls.length,
				caretDisabled: (caret() as HTMLButtonElement).disabled,
			},
		).toStrictEqual(
			{
				busy: "true",
				ariaDisabled: "true",
				calls: 0,
				caretDisabled: false,
			},
		);
	});

	it("passes aria-disabled through and still fires the primary click", () =>
	{
		const {onPrimaryClick} = renderSplit(
			{
				"aria-disabled": true,
			},
		);

		fireEvent.click(primary());

		expect(
			{
				ariaDisabled: primary().getAttribute("aria-disabled"),
				calls: onPrimaryClick.mock.calls.length,
			},
		).toStrictEqual(
			{
				ariaDisabled: "true",
				calls: 1,
			},
		);
	});

	it("disables both segments and marks the group data-disabled", () =>
	{
		renderSplit(
			{
				disabled: true,
			},
		);

		expect(
			{
				dataDisabled: group().getAttribute("data-disabled"),
				primaryDisabled: (primary() as HTMLButtonElement).disabled,
				caretDisabled: (caret() as HTMLButtonElement).disabled,
			},
		).toStrictEqual(
			{
				dataDisabled: "",
				primaryDisabled: true,
				caretDisabled: true,
			},
		);
	});

	it("renders shortcut keycaps after the label and sets aria-keyshortcuts", () =>
	{
		renderSplit(
			{
				shortcut: "cmd+enter",
				"aria-keyshortcuts": "Meta+Enter",
			},
		);

		expect(primary().getAttribute("aria-keyshortcuts")).toBe("Meta+Enter");
		expect(primary().querySelector("kbd")).not.toBeNull();
	});

	it("shows the menu when controlled open and reports close on item choice", async () =>
	{
		const onOpenChange = vi.fn<(open: boolean) => void>();
		renderSplit(
			{
				open: true,
				onOpenChange,
			},
		);
		await flush();

		expect(screen.getByRole("menu")).not.toBeNull();

		fireEvent.click(
			screen.getByRole(
				"menuitem",
				{
					name: "Allow once",
				},
			),
		);
		await flush();

		expect(onOpenChange.mock.calls.map((call) => call[0])).toStrictEqual([false]);
	});

	it("leaves no menu behind when unmounted while open", async () =>
	{
		const {unmount} = renderSplit();
		await openByClick();

		unmount();
		await flush();

		expect(screen.queryByRole("menu")).toBeNull();
	});
	describe("joined looks", () =>
	{
		const TRANSITION = [
			"transition-[background-color,box-shadow,color]",
			"stacks:transition-[box-shadow,color]",
			"duration-[60ms]",
			"ease-[cubic-bezier(.165,.84,.44,1)]",
		];
		const BASE = [
			"cds-reset",
			"relative",
			"outline-none",
			"focus-visible:shadow-focus",
			"[&:disabled:not([aria-busy])]:opacity-disabled",
			"disabled:pointer-events-none",
			"stacks:[&:disabled:not([aria-busy])]:opacity-100",
			"stacks:[&:disabled:not([aria-busy])]:text-button-disabled",
			"stacks:[&:disabled:not([aria-busy])]:[--shortcut-cap-ink:currentColor]",
		];
		const PRIMARY_SEGMENT = [
			"inline-flex",
			"items-center",
			"h-6",
			"px-2",
			"text-[13px]/[19px]",
			"rounded-r5",
			"rounded-e-none",
			"min-w-0",
			"shrink",
		];
		const CARET_SEGMENT = [
			"inline-flex",
			"items-center",
			"justify-center",
			"h-6",
			"w-auto",
			"px-1",
			"rounded-r5",
			"rounded-s-none",
		];
		const SEAM_FADE = [
			"[[data-cds-segment]:hover+&>[data-seam-line]]:opacity-0",
			"[&:has(+[data-cds-segment]:hover)>[data-seam-line]]:opacity-0",
			"[[data-cds-segment]:has([aria-expanded=true])+&>[data-seam-line]]:opacity-0",
			"[&:has(+[data-cds-segment]_[aria-expanded=true])>[data-seam-line]]:opacity-0",
		];
		const SOLID_SEAM_DISABLED = [
			"[[data-cds-segment]:has(:disabled:not([aria-busy]))+&:has(+[data-cds-segment]_:disabled:not([aria-busy]))]:opacity-disabled",
			"stacks:[[data-cds-segment]:has(:disabled:not([aria-busy]))+&:has(+[data-cds-segment]_:disabled:not([aria-busy]))]:opacity-100",
			"stacks:[[data-cds-segment]:has(:disabled:not([aria-busy]))+&:has(+[data-cds-segment]_:disabled:not([aria-busy]))]:bg-fill-disabled",
		];
		const ROOT = ["relative", "inline-flex", "w-fit", "shrink-0", "items-stretch", "rounded-r5", "group/split"];

		function seam()
		{
			const element = group().children[1];
			if (!(element instanceof HTMLElement)) throw new Error("seam missing");
			return element;
		}

		function looks()
		{
			const line = seam().querySelector("[data-seam-line]");
			return {
				root: [...group().classList],
				primary: [...primary().classList],
				caret: [...caret().classList],
				caretIcon: [...(caret().querySelector("svg")?.classList ?? [])],
				seamHidden: seam().getAttribute("aria-hidden"),
				seam: [...seam().classList],
				line: line === null ? null : [...line.classList],
			};
		}

		it("renders the primary variant as a solid joined pair with a faint on-primary seam line", () =>
		{
			renderSplit(
				{
					variant: "primary",
				},
			);

			const fill = [
				"bg-fill-primary",
				"text-on-primary",
				"font-control",
				"hover:bg-fill-primary-hover",
				"aria-expanded:bg-fill-primary-hover",
				"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
			];
			expect(looks()).toStrictEqual(
				{
					root: ROOT,
					primary: [...BASE, ...PRIMARY_SEGMENT, ...fill, ...TRANSITION],
					caret: [...BASE, ...CARET_SEGMENT, ...fill, ...TRANSITION],
					caretIcon: ["lucide", "lucide-chevron-down", "size-4"],
					seamHidden: "true",
					seam: [
						"relative",
						"w-px",
						"shrink-0",
						"self-stretch",
						"bg-fill-primary",
						...SEAM_FADE,
						...SOLID_SEAM_DISABLED,
					],
					line: ["absolute", "inset-x-0", "inset-y-1/4", "bg-on-primary", "opacity-25"],
				},
			);
		});

		it("renders the secondary variant with the field-drop shadow, inset ring and a border seam line", () =>
		{
			renderSplit(
				{
					variant: "secondary",
				},
			);

			const fill = [
				"bg-fill-secondary",
				"text-primary",
				"font-control-regular",
				"hover:bg-fill-secondary-hover",
				"aria-expanded:bg-fill-secondary-hover",
				"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
			];
			expect(looks()).toStrictEqual(
				{
					root: [
						...ROOT,
						"shadow-field-drop",
						"after:pointer-events-none",
						"after:absolute",
						"after:inset-0",
						"after:rounded-[inherit]",
						"after:shadow-[inset_0_0_0_1px_var(--color-fill-secondary-ring)]",
						"stacks:shadow-none",
						"stacks:after:shadow-none",
					],
					primary: [...BASE, ...PRIMARY_SEGMENT, ...fill, ...TRANSITION],
					caret: [...BASE, ...CARET_SEGMENT, ...fill, ...TRANSITION],
					caretIcon: ["lucide", "lucide-chevron-down", "size-4", "text-ink-muted"],
					seamHidden: "true",
					seam: ["relative", "w-px", "shrink-0", "self-stretch", "bg-fill-secondary", ...SEAM_FADE],
					line: ["absolute", "inset-x-0", "inset-y-1/4", "bg-border"],
				},
			);
		});

		it("defaults to the secondary look and drops the muted caret icon when disabled", () =>
		{
			renderSplit(
				{
					disabled: true,
				},
			);

			expect(
				{
					shadow: group().classList.contains("shadow-field-drop"),
					caretIcon: [...(caret().querySelector("svg")?.classList ?? [])],
				},
			).toStrictEqual(
				{
					shadow: true,
					caretIcon: ["lucide", "lucide-chevron-down", "size-4"],
				},
			);
		});

		it("renders the danger variant with the danger fill and an on-danger seam line", () =>
		{
			renderSplit(
				{
					variant: "danger",
				},
			);

			const fill = [
				"bg-fill-danger",
				"text-on-danger",
				"font-control",
				"hover:bg-fill-danger-hover",
				"aria-expanded:bg-fill-danger-hover",
				"stacks:[&:disabled:not([aria-busy])]:bg-fill-disabled",
			];
			expect(looks()).toStrictEqual(
				{
					root: ROOT,
					primary: [...BASE, ...PRIMARY_SEGMENT, ...fill, ...TRANSITION],
					caret: [...BASE, ...CARET_SEGMENT, ...fill, ...TRANSITION],
					caretIcon: ["lucide", "lucide-chevron-down", "size-4"],
					seamHidden: "true",
					seam: [
						"relative",
						"w-px",
						"shrink-0",
						"self-stretch",
						"bg-fill-danger",
						...SEAM_FADE,
						...SOLID_SEAM_DISABLED,
					],
					line: ["absolute", "inset-x-0", "inset-y-1/4", "bg-on-danger", "opacity-25"],
				},
			);
		});
	});

	describe("ghost look", () =>
	{
		const BASE = [
			"cds-reset",
			"relative",
			"outline-none",
			"focus-visible:shadow-focus",
			"[&:disabled:not([aria-busy])]:opacity-disabled",
			"disabled:pointer-events-none",
			"stacks:[&:disabled:not([aria-busy])]:opacity-100",
			"stacks:[&:disabled:not([aria-busy])]:text-button-disabled",
			"stacks:[&:disabled:not([aria-busy])]:[--shortcut-cap-ink:currentColor]",
		];
		const GHOST_BUTTON = ["group/btn", "isolate", "inline-flex", "items-center", "rounded-r5"];
		const RING = [
			"shadow-[inset_0_0_0_1px_var(--split-ring,transparent)]",
			"transition-[box-shadow]",
			"duration-[60ms]",
			"ease-[cubic-bezier(.165,.84,.44,1)]",
			"[&:not([data-disabled])]:hover:[--split-ring:var(--color-border)]",
			"data-[popup-open]:[--split-ring:var(--color-border)]",
			"[&:not([data-disabled])]:has-[[aria-pressed=true]]:[--split-ring:var(--color-border)]",
		];
		const ROOT = ["relative", "inline-flex", "w-fit", "shrink-0", "items-stretch", "rounded-r5", "group/split"];
		/* Upstream `cn`: under fizzy colour the ghost group drops its ring and the segment paints fill the segment. */
		const FIZZY_ROOT = ["stacks:shadow-none", "stacks:[&_[data-cds-part=paint]]:p-0"];
		/* Upstream `eF`: under fizzy colour hovering or opening the group paints both segments instead. */
		const FIZZY_HOVER = [
			"stacks:group-[:not([data-disabled])]/split:group-hover/split:not-aria-pressed:[&_[data-cds-part=paint]]:bg-fill-button-ghost-hover",
			"stacks:group-data-[popup-open]/split:not-aria-pressed:[&_[data-cds-part=paint]]:bg-fill-button-ghost-hover",
			"stacks:hover:not-aria-pressed:[&_[data-cds-part=paint]]:layers-1-fill-button-layer",
		];
		const PAINT = [
			"absolute",
			"inset-0",
			"-z-[1]",
			"rounded-[inherit]",
			"p-[var(--split-inset)]",
			"bg-clip-content",
			"group-hover/btn:bg-fill-ghost-hover",
			"group-aria-expanded/btn:bg-fill-ghost-hover",
			"group-aria-pressed/btn:bg-accent-100/15",
			"stacks:group-[:disabled:not([aria-busy])]/btn:bg-transparent",
			"transition-[background-color,box-shadow,color]",
			"stacks:transition-[box-shadow,color]",
			"duration-[60ms]",
			"ease-[cubic-bezier(.165,.84,.44,1)]",
		];
		const STYLE =
		{
			h: "24px",
			tuck: "calc((var(--split-h) - 20px) / 2)",
			inset: "min(calc(var(--split-tuck) / 2), 3px)",
		};

		function paintOf(button: HTMLElement)
		{
			const paint = button.querySelector("[data-cds-part=paint]");
			return paint === null
				? null
				:
					{
						hidden: paint.getAttribute("aria-hidden"),
						classes: [...paint.classList],
					};
		}

		function ghostLooks(root: HTMLElement, primaryButton: HTMLElement, caretButton: HTMLElement)
		{
			const seamElement = root.children[1];
			if (!(seamElement instanceof HTMLElement)) throw new Error("seam missing");
			return {
				root: [...root.classList],
				style:
				{
					h: root.style.getPropertyValue("--split-h"),
					tuck: root.style.getPropertyValue("--split-tuck"),
					inset: root.style.getPropertyValue("--split-inset"),
				},
				primary: [...primaryButton.classList],
				primaryPaint: paintOf(primaryButton),
				caret: [...caretButton.classList],
				caretPaint: paintOf(caretButton),
				seam: [...seamElement.classList],
				seamChildren: seamElement.children.length,
			};
		}

		it("renders the icon-only ghost with the ring, inset paint, caret tuck and widened caret hit area", () =>
		{
			render(
				<SplitDropdownButton
					variant="ghost"
					icon={<svg data-testid="send-icon" />}
					aria-label="Send"
					menuLabel="More send options"
					items={[
						{
							label: "Send later",
							onSelect: () =>
							{
							},
						},
					]}
					onPrimaryClick={() =>
					{
					}}
				/>,
			);

			expect(
				ghostLooks(
					screen.getByRole(
						"group",
						{
							name: "Send",
						},
					),
					screen.getByRole(
						"button",
						{
							name: "Send",
						},
					),
					screen.getByRole(
						"button",
						{
							name: "More send options",
						},
					),
				),
			).toStrictEqual(
				{
					root: [...ROOT, ...RING, ...FIZZY_ROOT],
					style: STYLE,
					primary: [
						...BASE,
						...GHOST_BUTTON,
						"justify-center",
						"aria-pressed:text-accent-100",
						"size-[var(--split-h)]",
						"group-data-[popup-open]/split:pointer-events-none",
						...FIZZY_HOVER,
					],
					primaryPaint:
					{
						hidden: "true",
						classes: PAINT,
					},
					caret: [
						...BASE,
						...GHOST_BUTTON,
						"justify-center",
						"h-[var(--split-h)]",
						"w-auto",
						"px-1",
						"-ms-[var(--split-tuck)]",
						"pointer-events-none",
						"after:absolute",
						"after:inset-y-0",
						"after:content-['']",
						"after:pointer-events-auto",
						"after:start-[calc(var(--split-tuck)-1px)]",
						"after:-end-[calc(3px+var(--split-tuck))]",
						...FIZZY_HOVER,
					],
					caretPaint:
					{
						hidden: "true",
						classes: PAINT,
					},
					seam: ["w-px", "shrink-0", "self-stretch"],
					seamChildren: 0,
				},
			);
		});

		it("renders the labeled ghost with flush inner paints and a caret hit area past its end", () =>
		{
			renderSplit(
				{
					variant: "ghost",
				},
			);

			expect(ghostLooks(group(), primary(), caret())).toStrictEqual(
				{
					root: [
						...ROOT,
						...RING,
						...FIZZY_ROOT,
						"[&>[data-cds-segment]:first-child_[data-cds-part=paint]]:pe-0",
						"[&>[data-cds-segment]:last-child_[data-cds-part=paint]]:ps-0",
					],
					style: STYLE,
					primary: [
						...BASE,
						...GHOST_BUTTON,
						"aria-pressed:text-accent-100",
						"h-[var(--split-h)]",
						"min-w-0",
						"shrink",
						"text-[13px]/[19px]",
						"ps-2",
						"pe-[5px]",
						...FIZZY_HOVER,
					],
					primaryPaint:
					{
						hidden: "true",
						classes: PAINT,
					},
					caret: [
						...BASE,
						...GHOST_BUTTON,
						"justify-center",
						"h-[var(--split-h)]",
						"w-auto",
						"ps-0",
						"pe-1",
						"after:absolute",
						"after:inset-y-0",
						"after:start-0",
						"after:-end-2",
						"after:content-['']",
						...FIZZY_HOVER,
					],
					caretPaint:
					{
						hidden: "true",
						classes: PAINT,
					},
					seam: ["w-px", "shrink-0", "self-stretch"],
					seamChildren: 0,
				},
			);
		});

		it("uses a 28px control height for the touch ghost", () =>
		{
			renderSplit(
				{
					variant: "ghost",
					size: "touch",
				},
			);

			expect(group().style.getPropertyValue("--split-h")).toBe("28px");
		});

		it("marks the root data-popup-open while the ghost menu is open", async () =>
		{
			renderSplit(
				{
					variant: "ghost",
				},
			);

			const before = group().hasAttribute("data-popup-open");
			await openByClick();

			expect(
				{
					before,
					open: group().getAttribute("data-popup-open"),
				},
			).toStrictEqual(
				{
					before: false,
					open: "",
				},
			);
		});

		it("sets aria-pressed on a pressed ghost primary", () =>
		{
			renderSplit(
				{
					variant: "ghost",
					pressed: true,
				},
			);

			expect(primary().getAttribute("aria-pressed")).toBe("true");
		});

		it("adds no paint layer to the joined variants", () =>
		{
			renderSplit(
				{
					variant: "primary",
				},
			);

			expect(group().querySelectorAll("[data-cds-part=paint]").length).toBe(0);
		});
	});

	describe("size scale", () =>
	{
		function sizeLooks()
		{
			return {
				h: group().style.getPropertyValue("--split-h"),
				root: [...group().classList].filter((name) => name.startsWith("rounded")),
				primary: [...primary().classList].filter((name) => /^(h-|px-|text-\[|rounded-r)/.test(name)),
				caret: [...caret().classList].filter((name) => /^(h-|rounded-r)/.test(name)),
				caretIcon: [...(caret().querySelector("svg")?.classList ?? [])].filter((name) =>
					name.startsWith("size-"),
				),
			};
		}

		it("sizes the default split to 24px controls with 13/19 text and a 6px radius", () =>
		{
			renderSplit(
				{
					variant: "primary",
				},
			);

			expect(sizeLooks()).toStrictEqual(
				{
					h: "24px",
					root: ["rounded-r5"],
					primary: ["h-6", "px-2", "text-[13px]/[19px]", "rounded-r5"],
					caret: ["h-6", "rounded-r5"],
					caretIcon: ["size-4"],
				},
			);
		});

		it("sizes the sm split to 20px controls with 12/17 text, a 5px radius and a 12px caret icon", () =>
		{
			renderSplit(
				{
					variant: "primary",
					size: "sm",
				},
			);

			expect(sizeLooks()).toStrictEqual(
				{
					h: "20px",
					root: ["rounded-r4"],
					primary: ["h-5", "px-1.5", "text-[12px]/[17px]", "rounded-r4"],
					caret: ["h-5", "rounded-r4"],
					caretIcon: ["size-3"],
				},
			);
		});

		it("sizes the touch split to 28px controls with an 8px radius", () =>
		{
			renderSplit(
				{
					variant: "secondary",
					size: "touch",
				},
			);

			expect(sizeLooks()).toStrictEqual(
				{
					h: "28px",
					root: ["rounded-r6"],
					primary: ["h-7", "px-2", "text-[13px]/[19px]", "rounded-r6"],
					caret: ["h-7", "rounded-r6"],
					caretIcon: ["size-4"],
				},
			);
		});

		it("gives the sm ghost its 5px radius and 12/17 label text", () =>
		{
			renderSplit(
				{
					variant: "ghost",
					size: "sm",
				},
			);

			expect(
				{
					h: group().style.getPropertyValue("--split-h"),
					root: [...group().classList].filter((name) => name.startsWith("rounded")),
					primary: [...primary().classList].filter((name) => /^(text-\[|rounded-r)/.test(name)),
					caret: [...caret().classList].filter((name) => name.startsWith("rounded-r")),
					caretIcon: [...(caret().querySelector("svg")?.classList ?? [])].filter((name) =>
						name.startsWith("size-"),
					),
				},
			).toStrictEqual(
				{
					h: "20px",
					root: ["rounded-r4"],
					primary: ["rounded-r4", "text-[12px]/[17px]"],
					caret: ["rounded-r4"],
					caretIcon: ["size-3"],
				},
			);
		});
	});

	describe("status slot", () =>
	{
		function slot()
		{
			const next = primary().nextElementSibling;
			if (!(next instanceof HTMLElement)) throw new Error("no status slot");
			return next;
		}

		it("renders no slot without a status", () =>
		{
			renderSplit();

			expect(primary().nextElementSibling).toBeNull();
		});

		it("renders the status after the primary in the variant fill", () =>
		{
			renderSplit(
				{
					variant: "secondary",
					status: "3",
				},
			);

			expect(
				{
					name: primary().getAttribute("aria-label") ?? primary().textContent,
					text: slot().textContent,
					tag: slot().tagName,
					sameParent: slot().parentElement === primary().parentElement,
					primary: [...primary().classList].filter((name) =>
						/^(peer\/slot|ps-|pe-|px-|rounded-e)/.test(name),
					),
					slot: [...slot().classList],
				},
			).toStrictEqual(
				{
					name: "Always allow",
					text: "3",
					tag: "SPAN",
					sameParent: true,
					primary: ["ps-2", "pe-1", "rounded-e-none", "peer/slot"],
					slot: [
						"flex",
						"shrink-0",
						"items-center",
						"self-stretch",
						"pe-3",
						"transition-colors",
						"duration-[60ms]",
						"ease-out",
						"peer-[:disabled:not([aria-busy])]/slot:opacity-disabled",
						"stacks:peer-[:disabled:not([aria-busy])]/slot:opacity-100",
						"stacks:peer-[:disabled:not([aria-busy])]/slot:text-button-disabled",
						"bg-fill-secondary",
						"peer-hover/slot:bg-fill-secondary-hover",
						"stacks:peer-[:disabled:not([aria-busy])]/slot:bg-fill-disabled",
					],
				},
			);
		});

		it("squares the ghost primary's end and rounds the slot's end", () =>
		{
			renderSplit(
				{
					variant: "ghost",
					status: "3",
				},
			);

			expect(
				{
					/* Upstream gives the status ghost neither the `wD` hover ring nor `df`'s flush inner paints. */
					group: [...group().classList],
					primary: [...primary().classList].filter((name) => /^(peer\/slot|ps-|pe-|rounded-e)/.test(name)),
					slot: [...slot().classList].filter((name) => /(bg-|rounded)/.test(name)),
					/* Upstream gives the status ghost neither `cn` nor `eF`. */
					fizzyGroupLook: [...group().classList, ...primary().classList, ...caret().classList].filter(
						(name) => /fill-button|:p-0|^stacks:shadow-none$/.test(name),
					),
				},
			).toStrictEqual(
				{
					group: [
						"relative",
						"inline-flex",
						"w-fit",
						"shrink-0",
						"items-stretch",
						"rounded-r5",
						"group/split",
					],
					primary: ["ps-2", "pe-1", "peer/slot", "rounded-e-none"],
					slot: ["peer-hover/slot:bg-fill-ghost-hover", "rounded-e-r5"],
					fizzyGroupLook: [],
				},
			);
		});
	});

	describe("tooltips", () =>
	{
		afterEach(() =>
		{
			vi.useRealTimers();
		});

		function hoverOpen(button: HTMLElement)
		{
			vi.useFakeTimers();
			fireEvent.pointerEnter(button.parentElement!);
			act(() =>
			{
				vi.advanceTimersByTime(300);
			});
		}

		function tooltipState(button: HTMLElement)
		{
			const tooltip = screen.getByRole("tooltip");
			return {
				text: tooltip.textContent,
				describedBy: button.getAttribute("aria-describedby") === tooltip.id,
				side: tooltip.className.split(" ").slice(-4).join(" "),
			};
		}

		it("wraps neither segment in a tooltip anchor when no tooltip is asked for", () =>
		{
			renderSplit();

			expect(
				{
					primaryParent: primary().parentElement!.className,
					caretParent: caret().parentElement!.hasAttribute("data-cds-segment"),
				},
			).toStrictEqual(
				{
					primaryParent: "contents",
					caretParent: true,
				},
			);
		});

		it("shows a string tooltip on the labeled primary, side top by default", () =>
		{
			renderSplit(
				{
					tooltip: "Don\u2019t ask again for this tool",
				},
			);
			hoverOpen(primary());

			expect(tooltipState(primary())).toStrictEqual(
				{
					text: "Don\u2019t ask again for this tool",
					describedBy: true,
					side: "bottom-full left-1/2 mb-1 -translate-x-1/2",
				},
			);
		});

		it("names an icon-only primary's tooltip after its aria-label when tooltip is true, on tooltipSide", () =>
		{
			render(
				<SplitDropdownButton
					variant="ghost"
					icon={<span>+</span>}
					aria-label="New tab"
					tooltip
					tooltipSide="bottom"
					menuLabel="More tab options"
					items={[
						{
							label: "Duplicate",
							onSelect: () =>
							{
							},
						},
					]}
					onPrimaryClick={() =>
					{
					}}
				/>,
			);
			const button = screen.getByRole(
				"button",
				{
					name: "New tab",
				},
			);
			hoverOpen(button);

			expect(tooltipState(button)).toStrictEqual(
				{
					text: "New tab",
					describedBy: true,
					side: "top-full left-1/2 mt-1 -translate-x-1/2",
				},
			);
		});

		it("shows the menu label as the caret's tooltip when menuTooltip is true", () =>
		{
			renderSplit(
				{
					menuTooltip: true,
				},
			);
			hoverOpen(caret());

			expect(tooltipState(caret())).toStrictEqual(
				{
					text: "More allow options",
					describedBy: true,
					side: "bottom-full left-1/2 mb-1 -translate-x-1/2",
				},
			);
		});

		it("keeps the stacked approval layout's flex-auto primary reachable through the tooltip anchor", () =>
		{
			renderSplit(
				{
					tooltip: "Applies to this session only",
				},
			);

			expect([...primary().parentElement!.classList]).toStrictEqual(["relative", "flex", "min-w-0", "shrink"]);
		});
	});
});

describe("SplitDropdownButton disabled look, as upstream's rM / NM / CY / CL", () =>
{
	it("drops the secondary frame's drop shadow and ring, the ghost group ring, and the paint's background-color transition under fizzy colour (upstream sO, cn, Yg), after the base rules", async () =>
	{
		const candidates = [
			"stacks:after:shadow-none",
			"stacks:shadow-none",
			"stacks:transition-[box-shadow,color]",
			"shadow-field-drop",
			"after:shadow-[inset_0_0_0_1px_var(--color-fill-secondary-ring)]",
			"transition-[background-color,box-shadow,color]",
			"shadow-[inset_0_0_0_1px_var(--split-ring,transparent)]",
		];
		const order = (await loadDesignSystem()).getClassOrder(candidates);
		const sorted = order.toSorted(([, a], [, b]) => (a === null || b === null ? 0 : a < b ? -1 : a > b ? 1 : 0));
		expect(sorted.map(([name]) => name)).toStrictEqual([
			"shadow-[inset_0_0_0_1px_var(--split-ring,transparent)]",
			"shadow-field-drop",
			"transition-[background-color,box-shadow,color]",
			"after:shadow-[inset_0_0_0_1px_var(--color-fill-secondary-ring)]",
			"stacks:shadow-none",
			"stacks:transition-[box-shadow,color]",
			"stacks:after:shadow-none",
		]);
	});

	it("compiles the ghost group's fizzy look (upstream cn, eF): no ring, flush paints, and segment paints on group hover or open", async () =>
	{
		const stacks =
			':where([data-cds-fizzy-lake~="color"], [data-cds-fizzy-lake~="color"] *):not(:where([data-cds-theme], [data-cds-theme] *))';
		const compiled = await compileAll([
			"stacks:[&_[data-cds-part=paint]]:p-0",
			"stacks:group-[:not([data-disabled])]/split:group-hover/split:not-aria-pressed:[&_[data-cds-part=paint]]:bg-fill-button-ghost-hover",
			"stacks:group-data-[popup-open]/split:not-aria-pressed:[&_[data-cds-part=paint]]:bg-fill-button-ghost-hover",
			"stacks:hover:not-aria-pressed:[&_[data-cds-part=paint]]:layers-1-fill-button-layer",
		]);
		expect(Object.values(compiled)).toStrictEqual([
			String.raw`@media (forced-colors: none) { .stacks\:\[\&_\[data-cds-part\=paint\]\]\:p-0${stacks} [data-cds-part=paint] { padding: 0px; } }`,
			String.raw`@media (forced-colors: none) { @media (hover: hover) { .stacks\:group-\[\:not\(\[data-disabled\]\)\]\/split\:group-hover\/split\:not-aria-pressed\:\[\&_\[data-cds-part\=paint\]\]\:bg-fill-button-ghost-hover${stacks}:is(:where(.group\/split):is(:not([data-disabled])) *):is(:where(.group\/split):hover *):not([aria-pressed="true"]) [data-cds-part=paint] { background-color: var(--upstream-fill-button-ghost-hover); } } }`,
			String.raw`@media (forced-colors: none) { .stacks\:group-data-\[popup-open\]\/split\:not-aria-pressed\:\[\&_\[data-cds-part\=paint\]\]\:bg-fill-button-ghost-hover${stacks}:is(:where(.group\/split)[data-popup-open] *):not([aria-pressed="true"]) [data-cds-part=paint] { background-color: var(--upstream-fill-button-ghost-hover); } }`,
			String.raw`@media (forced-colors: none) { @media (hover: hover) { .stacks\:hover\:not-aria-pressed\:\[\&_\[data-cds-part\=paint\]\]\:layers-1-fill-button-layer${stacks}:hover:not([aria-pressed="true"]) [data-cds-part=paint] { background-image: linear-gradient(var(--color-fill-button-layer) 0 0); } } }`,
		]);
	});

	it("compiles the disabled slot, solid seam and ghost paint selectors, skipping busy segments, with the fizzy parts under stacks:", async () =>
	{
		const stacks =
			':where([data-cds-fizzy-lake~="color"], [data-cds-fizzy-lake~="color"] *):not(:where([data-cds-theme], [data-cds-theme] *))';
		const seam =
			"[[data-cds-segment]:has(:disabled:not([aria-busy]))+&:has(+[data-cds-segment]_:disabled:not([aria-busy]))]";
		const compiled = await compileAll([
			"peer-[:disabled:not([aria-busy])]/slot:opacity-disabled",
			"stacks:peer-[:disabled:not([aria-busy])]/slot:bg-fill-disabled",
			`${seam}:opacity-disabled`,
			`stacks:${seam}:bg-fill-disabled`,
			"stacks:group-[:disabled:not([aria-busy])]/btn:bg-transparent",
		]);
		expect(Object.values(compiled)).toStrictEqual([
			String.raw`.peer-\[\:disabled\:not\(\[aria-busy\]\)\]\/slot\:opacity-disabled:is(:where(.peer\/slot):is(:disabled:not([aria-busy])) ~ *) { opacity: var(--upstream-opacity-disabled, 0.4); }`,
			String.raw`@media (forced-colors: none) { .stacks\:peer-\[\:disabled\:not\(\[aria-busy\]\)\]\/slot\:bg-fill-disabled${stacks}:is(:where(.peer\/slot):is(:disabled:not([aria-busy])) ~ *) { background-color: var(--upstream-fill-disabled); } }`,
			String.raw`[data-cds-segment]:has(:disabled:not([aria-busy])) + .\[\[data-cds-segment\]\:has\(\:disabled\:not\(\[aria-busy\]\)\)\+\&\:has\(\+\[data-cds-segment\]_\:disabled\:not\(\[aria-busy\]\)\)\]\:opacity-disabled:has( + [data-cds-segment] :disabled:not([aria-busy])) { opacity: var(--upstream-opacity-disabled, 0.4); }`,
			String.raw`@media (forced-colors: none) { [data-cds-segment]:has(:disabled:not([aria-busy])) + .stacks\:\[\[data-cds-segment\]\:has\(\:disabled\:not\(\[aria-busy\]\)\)\+\&\:has\(\+\[data-cds-segment\]_\:disabled\:not\(\[aria-busy\]\)\)\]\:bg-fill-disabled${stacks}:has( + [data-cds-segment] :disabled:not([aria-busy])) { background-color: var(--upstream-fill-disabled); } }`,
			String.raw`@media (forced-colors: none) { .stacks\:group-\[\:disabled\:not\(\[aria-busy\]\)\]\/btn\:bg-transparent${stacks}:is(:where(.group\/btn):is(:disabled:not([aria-busy])) *) { background-color: transparent; } }`,
		]);
	});
});
