// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useState} from "react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";

import {
	ContextMenu,
	ContextMenuTrigger,
	Menu,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "../src/components/ui/menu";
import {preloadMenuSheet} from "../src/components/ui/menu-sheet-loader";
import {submenuAnchor} from "../src/components/ui/menu-anchor";
import {DensityOverride} from "../src/components/ui/density";
import {CompactScope, PanelsOff} from "./fizzy-lake-off";
import {type Density} from "../src/components/ui/density-context";

/* The sheet presentation is a lazy chunk; load it up front so sheet tests render synchronously, as on a phone. */
beforeAll(async () => {
	await preloadMenuSheet();
});

afterEach(() => {
	cleanup();
});

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

function weightClasses(el: Element): string[] {
	return [...el.classList].filter((name) => /^font-(normal|medium|semibold|control|control-regular)$/.test(name));
}

function itemWeights(): string[][] {
	return [...screen.getAllByRole("menuitem"), ...screen.getAllByRole("menuitemcheckbox")].map(weightClasses);
}

function RowMenuBody({onCopy, onDelete}: {onCopy: () => void; onDelete: () => void}) {
	const [status, setStatus] = useState("active");
	const [showPr, setShowPr] = useState(true);
	return (
		<>
			<MenuLabel>Session</MenuLabel>
			<MenuSub>
				<MenuSubTrigger value="Active">Status</MenuSubTrigger>
				<MenuSubContent>
					<MenuRadioGroup value={status} onValueChange={setStatus}>
						<MenuRadioItem value="active">Active</MenuRadioItem>
						<MenuRadioItem value="all">All</MenuRadioItem>
					</MenuRadioGroup>
				</MenuSubContent>
			</MenuSub>
			<MenuSeparator />
			<MenuItem accelerator="c" onSelect={onCopy}>
				Copy link
			</MenuItem>
			<MenuCheckboxItem checked={showPr} onCheckedChange={setShowPr}>
				Show PR status
			</MenuCheckboxItem>
			<MenuItem accelerator="d" variant="danger" onSelect={onDelete}>
				Delete
			</MenuItem>
		</>
	);
}

function renderDropdown(handlers = {onCopy: vi.fn<() => void>(), onDelete: vi.fn<() => void>()}) {
	render(
		<CompactScope>
			<Menu>
				<MenuTrigger aria-label="More options">...</MenuTrigger>
				<MenuContent>
					<RowMenuBody {...handlers} />
				</MenuContent>
			</Menu>
		</CompactScope>,
	);
	return handlers;
}

async function openDropdown() {
	fireEvent.click(screen.getByRole("button", {name: "More options"}));
	await flush();
	return screen.getByRole("menu");
}

describe("Menu", () => {
	it("renders items with menuitem, menuitemcheckbox and menuitemradio roles", async () => {
		renderDropdown();
		await openDropdown();

		expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
			"StatusActive",
			"Copy linkC",
			"DeleteD",
		]);
		expect(
			screen.getAllByRole("menuitemcheckbox").map((el) => [el.textContent, el.getAttribute("aria-checked")]),
		).toEqual([["Show PR status", "true"]]);
		expect(screen.getByRole("menu").getAttribute("data-cds")).toBe("Menu");
		expect(screen.getAllByRole("separator")).toHaveLength(1);
	});

	it("weights every item with upstream's `font-normal font-control` (font-control-regular: 400, 435 under fizzy type)", async () => {
		renderDropdown();
		await openDropdown();

		expect(itemWeights()).toStrictEqual([
			["font-control-regular"],
			["font-control-regular"],
			["font-control-regular"],
			["font-control-regular"],
		]);
	});

	it("matches upstream's compact density on the container, items and shortcut hint", async () => {
		renderDropdown();
		const menu = await openDropdown();
		const item = screen.getByRole("menuitem", {name: /Copy link/});
		const hint = item.querySelector('[data-cds="Shortcut"]')?.parentElement;

		expect({
			container: menu.className.split(" ").filter((c) => ["rounded-r7", "p-1"].includes(c)),
			item: item.className
				.split(" ")
				.filter((c) =>
					[
						"h-6",
						"rounded-r5",
						"px-2",
						"py-[2.5px]",
						"text-[13px]/[19px]",
						"[--shortcut-cap-ink:var(--menu-muted)]",
					].includes(c),
				),
			hint: hint?.className.split(" ").filter((c) => c === "ml-auto"),
		}).toEqual({
			container: ["rounded-r7"],
			item: [
				"h-6",
				"rounded-r5",
				"px-2",
				"py-[2.5px]",
				"text-[13px]/[19px]",
				"[--shortcut-cap-ink:var(--menu-muted)]",
			],
			hint: ["ml-auto"],
		});
	});

	it("inherits comfortable density through a portaled submenu while preserving keyboard navigation", async () => {
		render(
			<Menu>
				<MenuTrigger aria-label="More options">...</MenuTrigger>
				<MenuContent density="comfortable">
					<RowMenuBody onCopy={vi.fn<() => void>()} onDelete={vi.fn<() => void>()} />
				</MenuContent>
			</Menu>,
		);
		await openDropdown();
		const trigger = screen.getByRole("menuitem", {name: /Status/});
		act(() => {
			trigger.focus();
		});
		fireEvent.keyDown(trigger, {key: "ArrowRight"});
		await flush();

		const densityClasses = ["h-8", "rounded-r6", "px-2.5", "py-1.5", "text-[14px]/[20px]"];
		const items = [
			trigger,
			screen.getByRole("menuitem", {name: /Copy link/}),
			screen.getByRole("menuitemcheckbox", {name: "Show PR status"}),
			screen.getByRole("menuitemradio", {name: "Active"}),
		];
		expect({
			popups: screen
				.getAllByRole("menu")
				.map((menu) =>
					menu.className
						.split(" ")
						.filter((value) => ["rounded-card", "p-1", "text-[14px]/[20px]"].includes(value)),
				),
			items: items.map((item) => item.className.split(" ").filter((value) => densityClasses.includes(value))),
			separator: screen.getByRole("separator").className,
			expanded: trigger.getAttribute("aria-expanded"),
		}).toStrictEqual({
			popups: Array.from({length: 2}, () => ["rounded-card", "text-[14px]/[20px]"]),
			items: Array.from({length: 4}, () => densityClasses),
			separator: "mx-2.5 my-1 h-px bg-border",
			expanded: "true",
		});
	});

	it("sizes leading icons like upstream's size:auto glyphs: 20px in comfortable menus, 16px in compact", async () => {
		const glyphSize = async (density: "compact" | "comfortable") => {
			render(
				<PanelsOff>
					<Menu>
						<MenuTrigger aria-label="More options">...</MenuTrigger>
						<MenuContent density={density}>
							<MenuItem icon={<svg data-testid="glyph" />}>Routines</MenuItem>
						</MenuContent>
					</Menu>
				</PanelsOff>,
			);
			await openDropdown();
			const slot = screen.getByTestId("glyph").parentElement;
			const sizes = slot?.className.split(" ").filter((value) => value.startsWith("[&_svg]:size-"));
			cleanup();
			return sizes;
		};
		expect({compact: await glyphSize("compact"), comfortable: await glyphSize("comfortable")}).toStrictEqual({
			compact: ["[&_svg]:size-4"],
			comfortable: ["[&_svg]:size-5"],
		});
	});

	it("lays icon rows out like cds: a size-icon slot with no margin and the row's gap-xs, so the label starts 30px in", async () => {
		const layout = async (density: "compact" | "comfortable") => {
			render(
				<PanelsOff>
					<Menu>
						<MenuTrigger aria-label="More options">...</MenuTrigger>
						<MenuContent density={density}>
							<MenuItem icon={<svg data-testid="glyph" />}>Add files</MenuItem>
							<MenuItem icon={<svg data-testid="glyph-2" />} description="Reconnect">
								Sentry
							</MenuItem>
						</MenuContent>
					</Menu>
				</PanelsOff>,
			);
			await openDropdown();
			const [row, twoLine] = screen.getAllByRole("menuitem");
			const gaps = (el: Element | undefined) =>
				[...(el?.classList ?? [])].filter((value) => value.startsWith("gap-") || value === "mr-1");
			const result = {
				rowGap: gaps(row),
				slot: screen.getByTestId("glyph").parentElement?.className,
				twoLineGap: gaps(twoLine),
				twoLineSlot: screen.getByTestId("glyph-2").parentElement?.className,
			};
			cleanup();
			return result;
		};
		expect({compact: await layout("compact"), comfortable: await layout("comfortable")}).toStrictEqual({
			compact: {
				rowGap: ["gap-1.5"],
				slot: "flex size-4 shrink-0 items-center justify-center -my-[max(0px,calc((1rem-1lh)/2))] [&_svg]:shrink-0 [&_svg]:size-4",
				twoLineGap: ["gap-1.5"],
				twoLineSlot:
					"flex h-[1lh] w-4 shrink-0 items-center justify-center self-start [&_svg]:shrink-0 [&_svg]:size-4",
			},
			comfortable: {
				rowGap: ["gap-2"],
				slot: "flex size-5 shrink-0 items-center justify-center -my-[max(0px,calc((1.25rem-1lh)/2))] [&_svg]:shrink-0 [&_svg]:size-5",
				twoLineGap: ["gap-2"],
				twoLineSlot:
					"flex h-[1lh] w-5 shrink-0 items-center justify-center self-start [&_svg]:shrink-0 [&_svg]:size-5",
			},
		});
	});

	it("sizes a compact two-line row at upstream's 40.5px: no min-height, 2.5px top, 4px bottom, a wrapping description", async () => {
		render(
			<CompactScope>
				<Menu>
					<MenuTrigger aria-label="More options">...</MenuTrigger>
					<MenuContent>
						<MenuItem description="Reconnect">Sentry</MenuItem>
					</MenuContent>
				</Menu>
			</CompactScope>,
		);
		await openDropdown();
		const row = screen.getByRole("menuitem", {name: /Sentry/});
		const rowClasses = row.className.split(" ");

		expect({
			rowHeight: rowClasses.filter((value) => /^(min-h-|h-\d|py-|pt-|pb-|items-)/.test(value)),
			description: row.querySelector("[data-menu-item-description]")?.className,
		}).toStrictEqual({
			rowHeight: ["items-start", "pb-1", "py-[2.5px]"],
			description: "break-words text-[12px]/[15px] text-[var(--menu-muted)]",
		});
	});

	it("keeps the text accelerator hint, hidden on touch, unless an item asks for a keycap", async () => {
		renderDropdown();
		await openDropdown();
		const shortcut = screen.getByRole("menuitem", {name: /Copy link/}).querySelector('[data-cds="Shortcut"]');

		expect({
			variant: shortcut?.getAttribute("data-variant"),
			coarseHidden: shortcut?.parentElement?.classList.contains("pointer-coarse:hidden"),
			kbd: shortcut?.parentElement?.querySelector('[data-cds="Kbd"]') ?? null,
		}).toStrictEqual({variant: "text", coarseHidden: true, kbd: null});
	});

	it("sets aria-keyshortcuts from the accelerator letter", async () => {
		renderDropdown();
		await openDropdown();

		expect(screen.getAllByRole("menuitem").map((el) => el.getAttribute("aria-keyshortcuts"))).toEqual([
			null,
			"c",
			"d",
		]);
	});

	it("marks danger items", async () => {
		renderDropdown();
		await openDropdown();

		expect(screen.getByRole("menuitem", {name: /Delete/}).getAttribute("data-variant")).toBe("danger");
	});

	it("opens a submenu on hover alone, without a click", async () => {
		renderDropdown();
		await openDropdown();
		const trigger = screen.getByRole("menuitem", {name: /Status/});

		fireEvent.pointerEnter(trigger, {pointerType: "mouse"});
		fireEvent.mouseEnter(trigger);
		fireEvent.pointerMove(trigger, {pointerType: "mouse"});
		fireEvent.mouseMove(trigger);
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 250);
			});
		});

		expect({
			menus: screen.getAllByRole("menu").length,
			expanded: trigger.getAttribute("aria-expanded"),
		}).toEqual({menus: 2, expanded: "true"});
	});

	it("gives popups upstream's 128px minimum width", async () => {
		renderDropdown();
		const menu = await openDropdown();

		expect(menu.className.split(" ").filter((c) => c.startsWith("min-w-"))).toEqual(["min-w-[128px]"]);
	});

	it("lets the scroller own upstream's gutter, edge fade and 1px transparent bottom border, so a two-row popup is 81px", async () => {
		renderDropdown();
		const menu = await openDropdown();
		const scroller = menu.querySelector("[data-menu-scroller]");

		expect(scroller?.className).toBe(
			"relative min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-y rounded-[inherit] border-b border-transparent forced-colors:border-b-0 p-1",
		);
	});

	it("outlines every popup in CanvasText under forced colors, as cds Menu does", async () => {
		renderDropdown();
		const menu = await openDropdown();

		expect(menu.className.split(" ").filter((value) => value.startsWith("forced-colors:"))).toStrictEqual([
			"forced-colors:border",
			"forced-colors:border-solid",
			"forced-colors:border-[color:CanvasText]",
		]);
	});

	async function openStatusSub() {
		await openDropdown();
		const trigger = screen.getByRole("menuitem", {name: /Status/});
		act(() => {
			trigger.focus();
		});
		fireEvent.keyDown(trigger, {key: "ArrowRight"});
		await flush();
		return {trigger, positioner: screen.getAllByRole("menu")[1]?.parentElement};
	}

	it("opens a submenu like cds: inline-end, 2px past the parent popup, aligned to the trigger's top", async () => {
		renderDropdown();
		const {positioner} = await openStatusSub();

		expect({
			side: positioner?.getAttribute("data-side"),
			sideOffset: positioner?.getAttribute("data-side-offset"),
			alignOffset: positioner?.getAttribute("data-align-offset"),
		}).toStrictEqual({side: "right", sideOffset: "2", alignOffset: "0"});
	});

	it("opens a submenu to the left under dir=rtl, as cds resolves inline-end", async () => {
		document.documentElement.dir = "rtl";
		try {
			renderDropdown();
			const {positioner} = await openStatusSub();

			expect(positioner?.getAttribute("data-side")).toBe("left");
		} finally {
			document.documentElement.dir = "";
		}
	});

	it("anchors a submenu to the parent popup's horizontal span at the trigger's height, as cds ua() does", () => {
		const popup = document.createElement("div");
		popup.setAttribute("role", "menu");
		const trigger = document.createElement("div");
		popup.append(trigger);
		document.body.append(popup);
		const rect = (x: number, y: number, width: number, height: number) =>
			({x, y, width, height, top: y, left: x, right: x + width, bottom: y + height}) as DOMRect;
		popup.getBoundingClientRect = () => rect(353.4, 43, 128, 120);
		trigger.getBoundingClientRect = () => rect(357.4, 47, 120, 24);

		const anchor = submenuAnchor({current: trigger});
		const actual = {contextElement: anchor.contextElement === trigger, rect: anchor.getBoundingClientRect()};
		popup.remove();

		expect(actual).toStrictEqual({
			contextElement: true,
			rect: {x: 353.4, y: 47, width: 128, height: 24, top: 47, left: 353.4, right: 481.4, bottom: 71},
		});
	});

	it("lets side-opening popups fall back to the end of the cross axis so they stay on screen", async () => {
		render(
			<>
				<Menu>
					<MenuTrigger aria-label="Right menu">R</MenuTrigger>
					<MenuContent side="right">
						<MenuItem>Right item</MenuItem>
					</MenuContent>
				</Menu>
				<Menu>
					<MenuTrigger aria-label="Bottom menu">B</MenuTrigger>
					<MenuContent side="bottom">
						<MenuItem>Bottom item</MenuItem>
					</MenuContent>
				</Menu>
			</>,
		);
		fireEvent.click(screen.getByRole("button", {name: "Right menu"}));
		await flush();
		const right = screen.getByRole("menuitem", {name: "Right item"}).closest("[data-side-offset]");
		fireEvent.click(screen.getByRole("button", {name: "Bottom menu"}));
		await flush();
		const bottom = screen.getByRole("menuitem", {name: "Bottom item"}).closest("[data-side-offset]");

		expect({
			right: right?.getAttribute("data-collision-fallback"),
			bottom: bottom?.getAttribute("data-collision-fallback"),
		}).toEqual({right: "end", bottom: null});
	});

	it("draws radio and checkbox checks in upstream fill-accent ink at stroke-width 3", async () => {
		renderDropdown();
		await openDropdown();
		const trigger = screen.getByRole("menuitem", {name: /Status/});
		act(() => {
			trigger.focus();
		});
		fireEvent.keyDown(trigger, {key: "ArrowRight"});
		await flush();

		const checks = [
			screen.getByRole("menuitemcheckbox", {name: "Show PR status"}),
			screen.getByRole("menuitemradio", {name: "Active"}),
		].map((item) => {
			const svg = item.querySelector("svg");
			return [svg?.getAttribute("class")?.includes("text-fill-accent"), svg?.getAttribute("stroke-width")];
		});

		expect(checks).toEqual([
			[true, "3"],
			[true, "3"],
		]);
	});

	it("puts a radio row's check slot before its digit, both in one first-line trailing wrapper", async () => {
		render(
			<PanelsOff>
				<Menu defaultOpen>
					<MenuTrigger aria-label="Mode">Mode</MenuTrigger>
					<MenuContent density="compact">
						<MenuRadioGroup value="auto">
							<MenuRadioItem value="auto" accelerator="1">
								Auto
							</MenuRadioItem>
							<MenuRadioItem value="plan" accelerator="2">
								Plan
							</MenuRadioItem>
						</MenuRadioGroup>
					</MenuContent>
				</Menu>
			</PanelsOff>,
		);
		await flush();

		const rows = screen.getAllByRole("menuitemradio").map((item) => {
			const trailing = item.querySelector("[data-menu-item-trailing]");
			return {
				trailing: trailing?.className,
				children: Array.from(trailing?.children ?? []).map((child) => ({
					cds: child.getAttribute("data-cds"),
					className: child.getAttribute("class"),
					checked: child.querySelector("svg") !== null,
					text: child.textContent,
				})),
			};
		});

		const trailing = "flex shrink-0 items-center gap-1 ms-3 h-[1lh] self-start";
		const checkSlot = "flex size-4 shrink-0 items-center justify-center pointer-coarse:-me-1";
		const digit = (text: string) => ({
			cds: "Shortcut",
			className:
				"inline-flex shrink-0 items-baseline gap-[0.3em] text-caption [&:where(:root[dir=rtl]_:dir(rtl))]:flex-row-reverse [&>kbd]:leading-[15px] pointer-coarse:hidden",
			checked: false,
			text,
		});
		expect(rows).toStrictEqual([
			{trailing, children: [{cds: null, className: checkSlot, checked: true, text: ""}, digit("1")]},
			{trailing, children: [{cds: null, className: checkSlot, checked: false, text: ""}, digit("2")]},
		]);
	});

	it("hides a checked row's digit with hideAccelerator but keeps its accelerator attributes", async () => {
		render(
			<Menu defaultOpen>
				<MenuTrigger aria-label="Model">Model</MenuTrigger>
				<MenuContent>
					<MenuRadioGroup value="opus">
						<MenuRadioItem value="opus" accelerator="1" hideAccelerator>
							Opus
						</MenuRadioItem>
						<MenuRadioItem value="fable" accelerator="2">
							Fable
						</MenuRadioItem>
					</MenuRadioGroup>
				</MenuContent>
			</Menu>,
		);
		await flush();

		const rows = screen.getAllByRole("menuitemradio").map((item) => ({
			text: item.textContent,
			key: item.getAttribute("aria-keyshortcuts"),
			accelerator: item.getAttribute("data-accelerator"),
			check: item.querySelector("svg") !== null,
		}));

		expect(rows).toStrictEqual([
			{text: "Opus", key: "1", accelerator: "1", check: true},
			{text: "Fable2", key: "2", accelerator: "2", check: false},
		]);
	});

	it("matches a digit accelerator by e.code (AZERTY Digit2 types é) and ignores key repeat", async () => {
		const onValueChange = vi.fn<(value: string) => void>();
		render(
			<Menu defaultOpen>
				<MenuTrigger aria-label="Model">Model</MenuTrigger>
				<MenuContent>
					<MenuRadioGroup value="opus" onValueChange={onValueChange}>
						<MenuRadioItem value="opus" accelerator="1">
							Opus
						</MenuRadioItem>
						<MenuRadioItem value="fable" accelerator="2">
							Fable
						</MenuRadioItem>
						<MenuRadioItem value="sonnet" accelerator="3">
							Sonnet
						</MenuRadioItem>
					</MenuRadioGroup>
				</MenuContent>
			</Menu>,
		);
		await flush();
		const menu = screen.getByRole("menu");

		fireEvent.keyDown(menu, {key: "3", code: "Digit3", repeat: true});
		fireEvent.keyDown(menu, {key: "é", code: "Digit2"});
		await flush();

		expect(onValueChange.mock.calls.map(([value]) => value)).toStrictEqual(["fable"]);
	});

	it("opens a submenu with ArrowRight and shows radio items", async () => {
		renderDropdown();
		await openDropdown();
		const trigger = screen.getByRole("menuitem", {name: /Status/});

		act(() => {
			trigger.focus();
		});
		fireEvent.keyDown(trigger, {key: "ArrowRight"});
		await flush();

		expect(screen.getAllByRole("menu")).toHaveLength(2);
		expect(
			screen.getAllByRole("menuitemradio").map((el) => [el.textContent, el.getAttribute("aria-checked")]),
		).toEqual([
			["Active", "true"],
			["All", "false"],
		]);
	});

	it("activates the item for an accelerator letter and closes the menu", async () => {
		const handlers = renderDropdown();
		const menu = await openDropdown();

		fireEvent.keyDown(menu, {key: "c"});
		await flush();

		expect(handlers.onCopy).toHaveBeenCalledTimes(1);
		expect(handlers.onDelete).not.toHaveBeenCalled();
		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("ignores accelerator letters pressed with a modifier", async () => {
		const handlers = renderDropdown();
		const menu = await openDropdown();

		fireEvent.keyDown(menu, {key: "c", metaKey: true});
		await flush();

		expect(handlers.onCopy).not.toHaveBeenCalled();
	});

	it("closes on Escape and restores focus to the trigger", async () => {
		renderDropdown();
		const menu = await openDropdown();

		fireEvent.keyDown(menu, {key: "Escape"});
		await flush();

		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(screen.getByRole("button", {name: "More options"}));
	});
});

describe("MenuCheckboxItem closeOnClick", () => {
	function renderCheckboxMenu(closeOnClick?: boolean) {
		const onCheckedChange = vi.fn<(checked: boolean) => void>();
		render(
			<Menu>
				<MenuTrigger aria-label="View options">...</MenuTrigger>
				<MenuContent>
					<MenuCheckboxItem
						checked={false}
						onCheckedChange={onCheckedChange}
						{...(closeOnClick === undefined ? {} : {closeOnClick})}
					>
						Background tasks
					</MenuCheckboxItem>
				</MenuContent>
			</Menu>,
		);
		return onCheckedChange;
	}

	async function clickRow() {
		fireEvent.click(screen.getByRole("button", {name: "View options"}));
		await flush();
		fireEvent.click(screen.getByRole("menuitemcheckbox", {name: "Background tasks"}));
		await flush();
	}

	it("keeps the menu open on pick by default", async () => {
		const onCheckedChange = renderCheckboxMenu();
		await clickRow();

		expect(onCheckedChange.mock.calls.map(([checked]) => checked)).toEqual([true]);
		expect(screen.getByRole("menu").getAttribute("data-cds")).toBe("Menu");
	});

	it("closes the menu on pick and returns focus to the trigger with closeOnClick", async () => {
		const onCheckedChange = renderCheckboxMenu(true);
		await clickRow();

		expect(onCheckedChange.mock.calls.map(([checked]) => checked)).toEqual([true]);
		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(screen.getByRole("button", {name: "View options"}));
	});
});

describe("MenuItem with a disabled reason", () => {
	const REASON = "Session file is still being written";

	function renderReasonMenu() {
		render(
			<CompactScope>
				<Menu>
					<MenuTrigger aria-label="More options">...</MenuTrigger>
					<MenuContent>
						<MenuItem onSelect={() => {}}>Copy link</MenuItem>
						<MenuItem disabled disabledReason={REASON}>
							Fork
						</MenuItem>
						<MenuItem onSelect={() => {}}>Archive</MenuItem>
					</MenuContent>
				</Menu>
			</CompactScope>,
		);
	}

	it("describes the disabled item by a hidden reason inside a role=none row, as upstream's UV", async () => {
		renderReasonMenu();
		await openDropdown();
		const fork = screen.getByRole("menuitem", {name: "Fork"});
		const reasonId = fork.getAttribute("aria-describedby") ?? "";
		const hiddenReason = document.getElementById(reasonId);

		expect({
			disabled: fork.getAttribute("aria-disabled"),
			title: fork.getAttribute("title"),
			parentRole: fork.parentElement?.getAttribute("role"),
			hiddenReason: hiddenReason?.outerHTML,
			reasonSibling: hiddenReason?.parentElement === fork.parentElement,
		}).toStrictEqual({
			disabled: "true",
			title: null,
			parentRole: "none",
			hiddenReason: `<span id="${reasonId}" hidden="" data-cds-disabled-reason="">${REASON}</span>`,
			reasonSibling: true,
		});
		expect(document.getElementById(fork.getAttribute("aria-describedby") ?? "")?.textContent).toBe(REASON);
	});

	it("paints disabled items at upstream's opacity-disabled (.4) with the focus ring kept", async () => {
		renderReasonMenu();
		await openDropdown();
		const classes = screen.getByRole("menuitem", {name: "Fork"}).className.split(" ");

		expect(classes.filter((c) => c.startsWith("data-[disabled]:"))).toStrictEqual([
			"data-[disabled]:pointer-events-none",
			"data-[disabled]:opacity-40",
			"data-[disabled]:focus-visible:shadow-focus",
		]);
	});

	it("shows the reason on side right when the row is hovered, and keeps it open on click", async () => {
		renderReasonMenu();
		await openDropdown();
		const row = screen.getByRole("menuitem", {name: "Fork"}).parentElement!;

		vi.useFakeTimers();
		try {
			fireEvent.pointerEnter(row);
			act(() => {
				vi.advanceTimersByTime(300);
			});
			fireEvent.click(row);
			const tip = screen.getByRole("tooltip");
			expect({side: tip.getAttribute("data-side"), text: tip.textContent}).toStrictEqual({
				side: "right",
				text: REASON,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("reaches the disabled item with ArrowDown and opens its reason at once on highlight", async () => {
		renderReasonMenu();
		await openDropdown();
		screen.getByRole("menuitem", {name: "Copy link"}).focus();

		fireEvent.keyDown(document.activeElement as HTMLElement, {key: "ArrowDown"});
		await flush();

		expect({
			active: document.activeElement?.textContent,
			highlighted: document.activeElement?.getAttribute("data-highlighted"),
			tooltip: screen.queryByRole("tooltip")?.textContent,
		}).toStrictEqual({active: "Fork", highlighted: "", tooltip: REASON});
	});

	it("leaves an enabled item with a reason prop unwrapped and undescribed", async () => {
		render(
			<Menu>
				<MenuTrigger aria-label="More options">...</MenuTrigger>
				<MenuContent>
					<MenuItem disabledReason={REASON}>Fork</MenuItem>
				</MenuContent>
			</Menu>,
		);
		await openDropdown();
		const fork = screen.getByRole("menuitem", {name: "Fork"});

		expect({
			describedBy: fork.getAttribute("aria-describedby"),
			parentRole: fork.parentElement?.getAttribute("role"),
		}).toStrictEqual({describedBy: null, parentRole: null});
	});
});

describe("ContextMenu", () => {
	it("opens the same content on right-click", async () => {
		const onCopy = vi.fn<() => void>();
		render(
			<ContextMenu>
				<ContextMenuTrigger>
					<div>Row title</div>
				</ContextMenuTrigger>
				<MenuContent>
					<RowMenuBody onCopy={onCopy} onDelete={vi.fn<() => void>()} />
				</MenuContent>
			</ContextMenu>,
		);
		expect(screen.queryByRole("menu")).toBeNull();

		fireEvent.contextMenu(screen.getByText("Row title"), {clientX: 40, clientY: 50});
		await flush();

		const menu = screen.getByRole("menu");
		expect(menu.getAttribute("data-cds")).toBe("ContextMenu");
		expect(itemWeights()).toStrictEqual([
			["font-control-regular"],
			["font-control-regular"],
			["font-control-regular"],
			["font-control-regular"],
		]);
		fireEvent.keyDown(menu, {key: "c"});
		await flush();
		expect(onCopy).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("menu")).toBeNull();
	});
});

describe("MenuContent on a coarse pointer", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubPointer(coarse: boolean) {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
				matches: query === "(pointer: coarse)" ? coarse : false,
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

	const DENSITY_TOKENS = new Set([
		"h-6",
		"h-8",
		"items-center",
		"rounded-r5",
		"rounded-r6",
		"px-2",
		"px-2.5",
		"py-[2.5px]",
		"py-1.5",
		"text-[13px]/[19px]",
		"text-[14px]/[20px]",
		"rounded-r7",
		"rounded-card",
		"[&_svg]:size-4",
		"[&_svg]:size-5",
	]);

	function tokens(element: Element | null | undefined): string[] {
		return (element?.getAttribute("class") ?? "").split(" ").filter((value) => DENSITY_TOKENS.has(value));
	}

	async function openCompactMenu() {
		render(
			<PanelsOff>
				<Menu>
					<MenuTrigger aria-label="More options">...</MenuTrigger>
					<MenuContent density="compact">
						<MenuItem icon={<svg data-testid="glyph" />}>Routines</MenuItem>
						<MenuSub>
							<MenuSubTrigger>Status</MenuSubTrigger>
							<MenuSubContent>
								<MenuItem>Active</MenuItem>
							</MenuSubContent>
						</MenuSub>
					</MenuContent>
				</Menu>
			</PanelsOff>,
		);
		await openDropdown();
		const trigger = screen.getByRole("menuitem", {name: /Status/});
		act(() => {
			trigger.focus();
		});
		fireEvent.keyDown(trigger, {key: "ArrowRight"});
		await flush();
		const [popup, subPopup] = screen.getAllByRole("menu");
		return {
			popup: tokens(popup),
			popupDensity: popup?.parentElement?.getAttribute("data-density"),
			item: tokens(screen.getByRole("menuitem", {name: "Routines"})),
			icon: tokens(screen.getByTestId("glyph").parentElement),
			subPopup: tokens(subPopup),
			subPopupDensity: subPopup?.parentElement?.getAttribute("data-density"),
			subItem: tokens(screen.getByRole("menuitem", {name: "Active"})),
		};
	}

	it("forces an explicitly compact menu and its submenu comfortable, as upstream's si does under (pointer: coarse)", async () => {
		stubPointer(true);
		const comfortableItem = ["h-8", "items-center", "rounded-r6", "px-2.5", "py-1.5", "text-[14px]/[20px]"];
		expect(await openCompactMenu()).toStrictEqual({
			popup: ["rounded-card", "text-[14px]/[20px]"],
			popupDensity: "comfortable",
			item: comfortableItem,
			icon: ["items-center", "[&_svg]:size-5"],
			subPopup: ["rounded-card", "text-[14px]/[20px]"],
			subPopupDensity: "comfortable",
			subItem: comfortableItem,
		});
	});

	it("keeps the compact menu on a fine pointer", async () => {
		stubPointer(false);
		const compactItem = ["h-6", "items-center", "rounded-r5", "px-2", "py-[2.5px]", "text-[13px]/[19px]"];
		expect(await openCompactMenu()).toStrictEqual({
			popup: ["rounded-r7", "text-[13px]/[19px]"],
			popupDensity: "compact",
			item: compactItem,
			icon: ["items-center", "[&_svg]:size-4"],
			subPopup: ["rounded-r7", "text-[13px]/[19px]"],
			subPopupDensity: "compact",
			subItem: compactItem,
		});
	});
});

describe("Menu sheet gate (coarse pointer, width < 640px)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function stubCoarseAtWidth(width: number) {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
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

	function presentation() {
		return {
			presentation: screen.getByRole("menu").getAttribute("data-presentation"),
			scrim: document.querySelector("[data-sheet-scrim]") !== null,
		};
	}

	it("keeps a coarse-pointer menu anchored at 1024px", async () => {
		stubCoarseAtWidth(1024);
		renderDropdown();
		await openDropdown();
		expect(presentation()).toStrictEqual({presentation: null, scrim: false});
	});

	it("presents a coarse-pointer menu as a sheet at 639px", async () => {
		stubCoarseAtWidth(639);
		renderDropdown();
		await openDropdown();
		expect(presentation()).toStrictEqual({presentation: "sheet", scrim: true});
	});

	function sheetAnatomy() {
		const menu = screen.getByRole("menu");
		const treeId = menu.getAttribute("data-sheet-tree");
		const scrim = document.querySelector<HTMLElement>("[data-sheet-scrim]");
		const positioner = menu.parentElement;
		const handle = menu.firstElementChild;
		const wrapper = handle?.nextElementSibling;
		const scroll = wrapper?.firstElementChild;
		return {
			popup: {
				presentation: menu.getAttribute("data-presentation"),
				size: menu.getAttribute("data-size"),
				depth: menu.getAttribute("data-cds-sheet-depth"),
				hasTreeId: treeId !== null && treeId !== "",
				classes: [
					"rounded-t-[14px]",
					"rounded-b-none",
					"pb-[max(env(safe-area-inset-bottom),0.5rem)]",
					"pl-[env(safe-area-inset-left,0px)]",
					"pr-[env(safe-area-inset-right,0px)]",
					"data-[starting-style]:translate-y-[calc(100%+1.5rem)]",
					"data-[ending-style]:translate-y-[calc(100%+1.5rem)]",
					"motion-reduce:transition-none",
				].filter((name) => menu.classList.contains(name)).length,
				maxHeight: menu.style.maxHeight,
				availableHeight: menu.style.getPropertyValue("--available-height"),
			},
			scrim: {
				role: scrim?.getAttribute("role"),
				presentation: scrim?.getAttribute("data-presentation"),
				matchesTree: scrim?.getAttribute("data-sheet-scrim") === treeId,
				className: scrim?.className,
			},
			positioner: {
				position: positioner?.style.position,
				inset: positioner?.style.inset,
				width: positioner?.style.width,
				transform: positioner?.style.transform,
				afterFill: positioner?.classList.contains("after:bg-surface-3"),
			},
			handle: {
				marker: handle?.hasAttribute("data-cds-sheet-handle"),
				ariaHidden: handle?.getAttribute("aria-hidden"),
				className: handle?.className,
				pill: handle?.firstElementChild?.className,
			},
			wrapper: wrapper?.className,
			scroll: {
				marker: scroll?.hasAttribute("data-cds-sheet-scroll"),
				className: scroll?.className,
				items: scroll?.querySelectorAll("[role=menuitem]").length,
			},
		};
	}

	it("renders the root sheet anatomy at coarse 639px, as upstream's MenuSheetPopup", async () => {
		stubCoarseAtWidth(639);
		renderDropdown();
		await openDropdown();
		expect(sheetAnatomy()).toStrictEqual({
			popup: {
				presentation: "sheet",
				size: "lg",
				depth: "0",
				hasTreeId: true,
				classes: 8,
				/* jsdom serializes the .95 product in canonical order. */
				maxHeight: "calc(0.95 * (100dvh - env(safe-area-inset-top, 0px)))",
				availableHeight: "calc((100dvh - env(safe-area-inset-top,0px)) * .9)",
			},
			scrim: {
				role: "presentation",
				presentation: "sheet",
				matchesTree: true,
				className:
					"draggable-none fixed inset-0 bg-backdrop transition-opacity duration-[300ms] ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
			},
			positioner: {position: "fixed", inset: "auto 0 0", width: "auto", transform: "none", afterFill: true},
			handle: {
				marker: true,
				ariaHidden: "true",
				className: "flex min-h-8 shrink-0 touch-none items-center justify-center select-none",
				pill: "h-1 w-9 rounded-full bg-border",
			},
			wrapper:
				"flex min-h-0 flex-1 flex-col transition-[translate] duration-[300ms] ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none group-data-[cds-sheet-drilled]/sheet:-translate-x-[calc(100%+env(safe-area-inset-left,0px))] rtl:group-data-[cds-sheet-drilled]/sheet:translate-x-[calc(100%+env(safe-area-inset-right,0px))]",
			scroll: {
				marker: true,
				className: "relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-1",
				items: 4,
			},
		});
	});

	const CLOSE_ROW_CLASS =
		"group/sheet-close block w-full rounded-r7 outline-none select-none focus-visible:outline-hidden [&:not(:focus-visible):not([data-highlighted]):not([data-cds-sheet-control-held])]:sr-only";

	function renderControlledSheet() {
		const onOpenChange = vi.fn<(open: boolean) => void>();
		function Harness() {
			const [open, setOpen] = useState(false);
			return (
				<Menu
					open={open}
					onOpenChange={(next) => {
						onOpenChange(next);
						setOpen(next);
					}}
				>
					<MenuTrigger aria-label="More options">...</MenuTrigger>
					<MenuContent>
						<MenuItem>Copy link</MenuItem>
					</MenuContent>
				</Menu>
			);
		}
		render(<Harness />);
		return onOpenChange;
	}

	it("ends the root sheet with an sr-only Close row, as upstream's Vt", async () => {
		stubCoarseAtWidth(639);
		renderDropdown();
		await openDropdown();
		const items = screen.getAllByRole("menuitem");
		const close = items.at(-1);
		const box = close?.firstElementChild;
		expect({
			last: close?.getAttribute("aria-label"),
			control: close?.hasAttribute("data-cds-sheet-control"),
			className: close?.className,
			inScroll: close?.parentElement?.hasAttribute("data-cds-sheet-scroll"),
			box: {
				highlightFill: box?.classList.contains("group-data-[highlighted]/sheet-close:bg-fill-ghost-hover"),
				lgRow: box?.classList.contains("min-h-10"),
				icon: box?.firstElementChild?.className,
				label: box?.lastElementChild?.className,
				text: box?.textContent,
			},
		}).toStrictEqual({
			last: "Close",
			control: true,
			className: CLOSE_ROW_CLASS,
			inScroll: true,
			box: {
				highlightFill: true,
				lgRow: true,
				icon: "flex size-6 shrink-0 items-center justify-center",
				label: "min-w-0 flex-1 truncate",
				text: "Close",
			},
		});
	});

	it("closes the sheet when the Close row is pressed", async () => {
		stubCoarseAtWidth(639);
		const onOpenChange = renderControlledSheet();
		await openDropdown();
		fireEvent.click(screen.getByRole("menuitem", {name: "Close"}));
		await flush();
		expect(onOpenChange.mock.calls.map(([open]) => open)).toStrictEqual([true, false]);
	});

	it("marks the popup pressed and a highlighted Close row held until the next click", async () => {
		stubCoarseAtWidth(639);
		renderDropdown();
		const menu = await openDropdown();
		const close = screen.getByRole("menuitem", {name: "Close"});
		close.setAttribute("data-highlighted", "");
		fireEvent.pointerDown(menu);
		const held = {
			pressed: menu.hasAttribute("data-cds-sheet-pressed"),
			held: close.hasAttribute("data-cds-sheet-control-held"),
		};
		fireEvent.keyDown(document, {key: "Shift"});
		expect({
			held,
			released: {
				pressed: menu.hasAttribute("data-cds-sheet-pressed"),
				held: close.hasAttribute("data-cds-sheet-control-held"),
			},
		}).toStrictEqual({held: {pressed: true, held: true}, released: {pressed: false, held: false}});
	});

	it("adds no Close row to an anchored menu", async () => {
		stubCoarseAtWidth(1024);
		renderDropdown();
		await openDropdown();
		expect(screen.queryByRole("menuitem", {name: "Close"})).toBeNull();
	});

	it("renders none of the sheet anatomy on a fine pointer at 639px", async () => {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
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
		renderDropdown();
		const menu = await openDropdown();
		expect({
			presentation: menu.getAttribute("data-presentation"),
			size: menu.getAttribute("data-size"),
			sheetMarkers: document.querySelectorAll(
				"[data-sheet-scrim], [data-sheet-tree], [data-cds-sheet-handle], [data-cds-sheet-scroll]",
			).length,
			roundedTop: menu.className.includes("rounded-t-[14px]"),
		}).toStrictEqual({presentation: null, size: null, sheetMarkers: 0, roundedTop: false});
	});

	async function openCompactSheet(override?: Density) {
		const menu = (
			<Menu>
				<MenuTrigger aria-label="More options">...</MenuTrigger>
				<MenuContent density="compact">
					<MenuItem icon={<svg data-testid="glyph" />} shortcut="⌘C">
						Copy link
					</MenuItem>
					<MenuSeparator />
					<MenuItem>Delete</MenuItem>
				</MenuContent>
			</Menu>
		);
		render(
			<PanelsOff>
				{override === undefined ? menu : <DensityOverride density={override}>{menu}</DensityOverride>}
			</PanelsOff>,
		);
		const popup = await openDropdown();
		const glyphSlot = screen.getByTestId("glyph").parentElement;
		const shortcut = screen.getByRole("menuitem", {name: /Copy link/}).lastElementChild;
		return {
			density: popup.parentElement?.getAttribute("data-density"),
			popupText: popup.classList.contains("text-[15px]/[22px]"),
			item: screen
				.getByRole("menuitem", {name: "Delete"})
				.className.split(" ")
				.filter((name) => SHEET_ITEM_TOKENS.has(name)),
			icon: glyphSlot?.classList.contains("[&_svg]:size-5"),
			shortcutPadding: shortcut?.classList.contains("pl-5"),
			separator: document
				.querySelector("[role=separator]")
				?.className.split(" ")
				.filter((name) => name.startsWith("mx-")),
		};
	}

	const SHEET_ITEM_TOKENS = new Set([
		"h-6",
		"h-8",
		"min-h-10",
		"items-center",
		"rounded-r5",
		"rounded-r6",
		"rounded-r7",
		"px-2",
		"px-2.5",
		"py-[2.5px]",
		"py-1.5",
		"py-[9px]",
		"text-[13px]/[19px]",
		"text-[14px]/[20px]",
		"text-[15px]/[22px]",
	]);

	const LG_SHEET = {
		density: "comfortable",
		popupText: true,
		item: ["min-h-10", "items-center", "rounded-r7", "px-2.5", "py-[9px]", "text-[15px]/[22px]"],
		icon: true,
		shortcutPadding: true,
		separator: ["mx-2.5"],
	};

	it("renders a compact menu's sheet with lg rows at forced comfortable density, as upstream's ta(\"lg\")", async () => {
		stubCoarseAtWidth(639);
		expect(await openCompactSheet()).toStrictEqual(LG_SHEET);
	});

	it("lets the sheet's lg comfortable sizing win over a compact density override", async () => {
		stubCoarseAtWidth(639);
		expect(await openCompactSheet("compact")).toStrictEqual(LG_SHEET);
	});

	it("keeps a controlled menu without onOpenChange anchored at 639px", async () => {
		stubCoarseAtWidth(639);
		render(
			<Menu open>
				<MenuTrigger aria-label="More options">...</MenuTrigger>
				<MenuContent>
					<MenuItem>Copy link</MenuItem>
				</MenuContent>
			</Menu>,
		);
		await flush();
		expect(presentation()).toStrictEqual({presentation: null, scrim: false});
	});

	it("keeps a structurally anchored menu anchored at 639px", async () => {
		stubCoarseAtWidth(639);
		render(
			<Menu>
				<MenuTrigger aria-label="More options">...</MenuTrigger>
				<MenuContent structurallyAnchored>
					<MenuItem>Copy link</MenuItem>
				</MenuContent>
			</Menu>,
		);
		await openDropdown();
		expect(presentation()).toStrictEqual({presentation: null, scrim: false});
	});

	it("keeps a coarse-pointer ContextMenu anchored at 1024px", async () => {
		stubCoarseAtWidth(1024);
		render(
			<ContextMenu>
				<ContextMenuTrigger>
					<div>Row title</div>
				</ContextMenuTrigger>
				<MenuContent>
					<MenuItem>Copy link</MenuItem>
				</MenuContent>
			</ContextMenu>,
		);
		fireEvent.contextMenu(screen.getByText("Row title"), {clientX: 40, clientY: 50});
		await flush();
		expect(presentation()).toStrictEqual({presentation: null, scrim: false});
	});

	it("presents a coarse-pointer ContextMenu as a sheet at 639px", async () => {
		stubCoarseAtWidth(639);
		render(
			<ContextMenu>
				<ContextMenuTrigger>
					<div>Row title</div>
				</ContextMenuTrigger>
				<MenuContent>
					<MenuItem>Copy link</MenuItem>
				</MenuContent>
			</ContextMenu>,
		);
		fireEvent.contextMenu(screen.getByText("Row title"), {clientX: 40, clientY: 50});
		await flush();
		expect(presentation()).toStrictEqual({presentation: "sheet", scrim: true});
	});

	async function drillIntoStatus() {
		stubCoarseAtWidth(639);
		renderDropdown();
		const root = await openDropdown();
		fireEvent.click(screen.getByRole("menuitem", {name: /Status/}));
		await flush();
		const child = Array.from(document.querySelectorAll<HTMLElement>("[role=menu]")).find((menu) => menu !== root);
		return {root, child};
	}

	function levelState(root: HTMLElement) {
		return {
			drilled: root.hasAttribute("data-cds-sheet-drilled"),
			ariaHidden: root.getAttribute("aria-hidden"),
			menus: document.querySelectorAll("[role=menu]").length,
		};
	}

	/* Upstream's cD, applied to every level of a sheet tree. */
	const COVERED_CLASSES = [
		"origin-top",
		"[&[data-cds-sheet-covered]:not([data-starting-style]):not([data-ending-style])]:-translate-y-3",
		"data-[cds-sheet-covered]:scale-[0.94]",
		"after:pointer-events-none",
		"after:absolute",
		"after:inset-0",
		"after:rounded-[inherit]",
		"after:bg-backdrop",
		"after:opacity-0",
		"after:transition-opacity",
		"after:duration-[300ms]",
		"motion-reduce:after:transition-none",
		"data-[cds-sheet-covered]:after:opacity-100",
	];

	it("gives every sheet level the covered-stack look and reduced-motion overrides, as upstream's cD", async () => {
		const {root, child} = await drillIntoStatus();
		const covered = (level: HTMLElement | undefined) =>
			COVERED_CLASSES.concat("motion-reduce:transition-none").filter((name) => level?.classList.contains(name));
		expect({root: covered(root), child: covered(child)}).toStrictEqual({
			root: [...COVERED_CLASSES, "motion-reduce:transition-none"],
			child: [...COVERED_CLASSES, "motion-reduce:transition-none"],
		});
	});

	it("drills a submenu into the sheet with a Back header titled by the trigger, as upstream's Bt", async () => {
		const {root, child} = await drillIntoStatus();
		const positioner = child?.parentElement;
		const header = child?.querySelector("[data-cds-sheet-scroll]")?.nextElementSibling;
		const back = header?.querySelector("[aria-label=Back]");
		const title = header?.lastElementChild;
		expect({
			parent: levelState(root),
			firstHighlighted: child
				?.querySelector("[data-cds-sheet-scroll] [role^=menuitem]")
				?.hasAttribute("data-highlighted"),
			positioner: {
				className: positioner?.className,
				position: positioner?.style.position,
				inset: positioner?.style.inset,
				zIndex: positioner?.style.zIndex,
			},
			child: {
				presentation: child?.getAttribute("data-presentation"),
				nested: child?.hasAttribute("data-nested"),
				sameTree: child?.getAttribute("data-sheet-tree") === root.getAttribute("data-sheet-tree"),
				depth: child?.getAttribute("data-cds-sheet-depth"),
				size: child?.getAttribute("data-size"),
				classes: [
					"bg-transparent",
					"shadow-none",
					"[&[data-ending-style]:not([data-cds-sheet-tree-closing])]:translate-x-full",
					"[&[data-ending-style][data-cds-sheet-tree-closing]]:translate-y-[calc(100%+1.5rem)]",
				].filter((name) => child?.classList.contains(name) === true).length,
				pill: child?.querySelector("[data-cds-sheet-handle]")?.firstElementChild?.className,
				closeRow: child?.querySelector("[aria-label=Close]") ?? null,
			},
			header: {
				className: header?.className,
				backRole: back?.getAttribute("role"),
				backWrapper: back?.parentElement?.className,
				backIcon: back?.firstElementChild?.className,
				backSvg: back?.querySelector("svg")?.classList.contains("size-5"),
				titleText: title?.textContent,
				titleHidden: title?.getAttribute("aria-hidden"),
				titleClass: title?.className,
			},
		}).toStrictEqual({
			parent: {drilled: true, ariaHidden: "true", menus: 2},
			firstHighlighted: true,
			positioner: {
				className: "[clip-path:inset(0_0_-200vh_0)]",
				position: "fixed",
				inset: "auto 0 0",
				zIndex: "220",
			},
			child: {
				presentation: "sheet",
				nested: true,
				sameTree: true,
				depth: "0",
				size: "lg",
				classes: 4,
				pill: "h-1 w-9 rounded-full bg-border opacity-0",
				closeRow: null,
			},
			header: {
				className: "order-first flex min-h-10 shrink-0 touch-none items-center gap-1.5 px-1 pb-1 select-none",
				backRole: "menuitem",
				backWrapper: "-me-2.5 shrink-0",
				backIcon: "flex size-6 shrink-0 items-center justify-center",
				backSvg: true,
				titleText: "Status",
				titleHidden: "true",
				titleClass: "min-w-0 flex-1 truncate text-start text-[15px]/[20px] font-semibold text-primary",
			},
		});
	});

	it("gives the sheet levels upstream's forced-colors resets and pressed scroll padding", async () => {
		const {root, child} = await drillIntoStatus();
		const tokens = [
			"forced-colors:border",
			"forced-colors:border-x-0",
			"forced-colors:border-b-0",
			"forced-colors:border-0",
			"[&[data-cds-sheet-pressed]_[data-cds-sheet-scroll]]:[scroll-padding-block:0px]",
		];
		const present = (level: HTMLElement | undefined) => tokens.filter((name) => level?.classList.contains(name));
		expect({root: present(root), child: present(child)}).toStrictEqual({
			root: [
				"forced-colors:border",
				"forced-colors:border-x-0",
				"forced-colors:border-b-0",
				"[&[data-cds-sheet-pressed]_[data-cds-sheet-scroll]]:[scroll-padding-block:0px]",
			],
			child: [
				"forced-colors:border-x-0",
				"forced-colors:border-b-0",
				"forced-colors:border-0",
				"[&[data-cds-sheet-pressed]_[data-cds-sheet-scroll]]:[scroll-padding-block:0px]",
			],
		});
	});

	it("pins every open level to the tallest level's height, as upstream's pinHeight and pushLevelHeight", async () => {
		vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
			if (this.getAttribute("role") !== "menu") return 0;
			return this.hasAttribute("data-nested") ? 320 : 200;
		});
		stubCoarseAtWidth(639);
		renderDropdown();
		const root = await openDropdown();
		const atOpen = root.style.height;
		fireEvent.click(screen.getByRole("menuitem", {name: /Status/}));
		await flush();
		const child = Array.from(document.querySelectorAll<HTMLElement>("[role=menu]")).find((menu) => menu !== root);
		const drilled = {root: root.style.height, child: child?.style.height};
		fireEvent.click(screen.getByRole("menuitem", {name: "Back"}));
		await flush();
		expect({atOpen, drilled, back: root.style.height}).toStrictEqual({
			atOpen: "200px",
			drilled: {root: "320px", child: "320px"},
			back: "200px",
		});
	});

	it("forwards popupProps to the sheet popup and moves the consumer className onto the content", async () => {
		stubCoarseAtWidth(639);
		const onKeyDownCapture = vi.fn<() => void>();
		render(
			<Menu>
				<MenuTrigger aria-label="More options">...</MenuTrigger>
				<MenuContent
					className="w-[240px]"
					popupProps={{"aria-label": "Templates", "data-x": "", onKeyDownCapture}}
				>
					<MenuItem>Copy link</MenuItem>
				</MenuContent>
			</Menu>,
		);
		const menu = await openDropdown();
		fireEvent.keyDown(menu, {key: "a"});
		const content = menu.querySelector("[data-cds-sheet-scroll]")?.parentElement;
		expect({
			presentation: menu.getAttribute("data-presentation"),
			label: menu.getAttribute("aria-label"),
			x: menu.hasAttribute("data-x"),
			popupWidth: menu.classList.contains("w-[240px]"),
			popupFull: menu.classList.contains("w-full"),
			contentWidth: content?.classList.contains("w-[240px]"),
			keyDownCapture: onKeyDownCapture.mock.calls.length,
		}).toStrictEqual({
			presentation: "sheet",
			label: "Templates",
			x: true,
			popupWidth: false,
			popupFull: true,
			contentWidth: true,
			keyDownCapture: 1,
		});
	});

	it("names the popup with the cds prop, anchored and as a sheet", async () => {
		const names: (string | null)[] = [];
		for (const width of [1024, 639]) {
			stubCoarseAtWidth(width);
			render(
				<Menu>
					<MenuTrigger aria-label="More options">...</MenuTrigger>
					<MenuContent cds="ModelSelector">
						<MenuItem>Copy link</MenuItem>
					</MenuContent>
				</Menu>,
			);
			names.push((await openDropdown()).getAttribute("data-cds"));
			cleanup();
		}
		expect(names).toStrictEqual(["ModelSelector", "ModelSelector"]);
	});

	it("closes the drilled level on Back and restores the parent", async () => {
		const {root} = await drillIntoStatus();
		fireEvent.click(screen.getByRole("menuitem", {name: "Back"}));
		await flush();
		expect(levelState(root)).toStrictEqual({drilled: false, ariaHidden: null, menus: 1});
	});

	/** Each level's tree-closing marker when Base UI starts its exit (`data-closed` with `data-ending-style`). */
	function recordEndingStyles(levels: HTMLElement[]) {
		const seen = new Map<HTMLElement, boolean>();
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				/* A level unmounted without an exit transition ends there. */
				for (const level of levels) {
					if (!level.isConnected && !seen.has(level))
						seen.set(level, level.hasAttribute("data-cds-sheet-tree-closing"));
				}
				const level = record.target;
				if (
					level instanceof HTMLElement &&
					(level.hasAttribute("data-closed") || level.hasAttribute("data-ending-style")) &&
					!seen.has(level)
				) {
					seen.set(level, level.hasAttribute("data-cds-sheet-tree-closing"));
				}
			}
		});
		for (const level of levels) observer.observe(level, {attributes: true});
		observer.observe(document.body, {childList: true, subtree: true});
		return () => {
			observer.disconnect();
			return levels.map((level) => seen.get(level) ?? null);
		};
	}

	function pressScrim() {
		const scrim = document.querySelector<HTMLElement>("[data-sheet-scrim]");
		if (scrim === null) throw new Error("no scrim");
		fireEvent.pointerDown(scrim, {pointerType: "touch", button: 0});
		fireEvent.mouseDown(scrim, {button: 0});
		fireEvent.pointerUp(scrim, {pointerType: "touch", button: 0});
		fireEvent.mouseUp(scrim, {button: 0});
		fireEvent.click(scrim, {button: 0});
	}

	it("marks every open level tree-closing before its exit when the scrim closes the sheet", async () => {
		const {root, child} = await drillIntoStatus();
		if (child === undefined) throw new Error("no drilled level");
		const stop = recordEndingStyles([root, child]);
		pressScrim();
		await flush();
		expect(stop()).toStrictEqual([true, true]);
	});

	it("lets a drilled level close on Back without the tree-closing marker", async () => {
		const {root, child} = await drillIntoStatus();
		if (child === undefined) throw new Error("no drilled level");
		const stop = recordEndingStyles([root, child]);
		fireEvent.click(screen.getByRole("menuitem", {name: "Back"}));
		await flush();
		expect(stop()).toStrictEqual([null, false]);
	});

	it("does not open a sheet submenu on hover", async () => {
		stubCoarseAtWidth(639);
		renderDropdown();
		await openDropdown();
		const trigger = screen.getByRole("menuitem", {name: /Status/});
		fireEvent.pointerEnter(trigger, {pointerType: "mouse"});
		fireEvent.mouseEnter(trigger);
		fireEvent.pointerMove(trigger, {pointerType: "mouse"});
		fireEvent.mouseMove(trigger);
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 250);
			});
		});
		expect({
			menus: document.querySelectorAll("[role=menu]").length,
			expanded: trigger.getAttribute("aria-expanded"),
		}).toStrictEqual({menus: 1, expanded: "false"});
	});

	/** A pointer event at `clientY` with a fixed timeStamp, so velocity is deterministic. */
	function pointer(target: Element, type: string, clientY: number, timeStamp: number) {
		const event = new MouseEvent(type, {bubbles: true, cancelable: true, button: 0, clientY});
		Object.defineProperty(event, "pointerId", {value: 1});
		Object.defineProperty(event, "timeStamp", {value: timeStamp});
		fireEvent(target, event);
	}

	/** jsdom has no pointer capture; the drag captures on the handle and releases on pointerup. */
	function stubPointerCapture() {
		const captured = new Set<number>();
		HTMLElement.prototype.setPointerCapture = (pointerId) => {
			captured.add(pointerId);
		};
		HTMLElement.prototype.hasPointerCapture = (pointerId) => captured.has(pointerId);
		HTMLElement.prototype.releasePointerCapture = (pointerId) => {
			captured.delete(pointerId);
		};
	}

	/** Every sheet level is 400px tall, resting on the viewport bottom at 800. */
	function stubSheetRects() {
		stubPointerCapture();
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
			DOMRect.fromRect({x: 0, y: 400, width: 639, height: 400}),
		);
	}

	function dragStyles(levels: HTMLElement[]) {
		return {
			levels: levels.map((level) => ({translate: level.style.translate, height: level.style.height})),
			scrim: document.querySelector<HTMLElement>("[data-sheet-scrim]")?.style.opacity,
		};
	}

	it("follows a handle drag down and dismisses past a quarter of the rest height, as upstream's ct", async () => {
		stubCoarseAtWidth(639);
		stubSheetRects();
		renderDropdown();
		const menu = await openDropdown();
		const handle = menu.querySelector("[data-cds-sheet-handle]");
		if (handle === null) throw new Error("no handle");
		pointer(handle, "pointerdown", 400, 0);
		pointer(handle, "pointermove", 600, 1000);
		const during = dragStyles([menu]);
		const scrim = document.querySelector<HTMLElement>("[data-sheet-scrim]");
		pointer(handle, "pointerup", 600, 1000);
		const released = {
			levels: [{translate: menu.style.translate, height: menu.style.height}],
			scrim: scrim?.style.opacity,
		};
		await flush();
		expect({during, released, open: screen.queryByRole("menu") !== null}).toStrictEqual({
			during: {levels: [{translate: "0 200px", height: "400px"}], scrim: "0.5"},
			released: {levels: [{translate: "0 calc(100% + 1.5rem)", height: "400px"}], scrim: ""},
			open: false,
		});
	});

	it("springs back from a short, slow handle drag", async () => {
		stubCoarseAtWidth(639);
		stubSheetRects();
		renderDropdown();
		const menu = await openDropdown();
		const handle = menu.querySelector("[data-cds-sheet-handle]");
		if (handle === null) throw new Error("no handle");
		pointer(handle, "pointerdown", 400, 0);
		pointer(handle, "pointermove", 450, 1000);
		pointer(handle, "pointerup", 450, 1000);
		await flush();
		expect({styles: dragStyles([menu]), open: screen.queryByRole("menu") !== null}).toStrictEqual({
			styles: {levels: [{translate: "", height: ""}], scrim: ""},
			open: true,
		});
	});

	it("dismisses on a fast flick, but not when the finger rested before release", async () => {
		stubCoarseAtWidth(639);
		stubSheetRects();
		renderDropdown();
		const menu = await openDropdown();
		const handle = menu.querySelector("[data-cds-sheet-handle]");
		if (handle === null) throw new Error("no handle");
		pointer(handle, "pointerdown", 400, 0);
		pointer(handle, "pointermove", 420, 10);
		pointer(handle, "pointerup", 420, 160);
		await flush();
		const restedOpen = screen.queryByRole("menu") !== null;
		pointer(handle, "pointerdown", 400, 200);
		pointer(handle, "pointermove", 420, 210);
		pointer(handle, "pointerup", 420, 220);
		await flush();
		expect({restedOpen, flickedOpen: screen.queryByRole("menu") !== null}).toStrictEqual({
			restedOpen: true,
			flickedOpen: false,
		});
	});

	it("opens the tall detent when an overflowing sheet is dragged up past 40px", async () => {
		stubCoarseAtWidth(639);
		stubSheetRects();
		renderDropdown();
		const menu = await openDropdown();
		const scroll = menu.querySelector("[data-cds-sheet-scroll]");
		const handle = menu.querySelector("[data-cds-sheet-handle]");
		if (scroll === null || handle === null) throw new Error("no sheet chrome");
		Object.defineProperty(scroll, "scrollHeight", {configurable: true, value: 900});
		const before = menu.getAttribute("data-cds-sheet-detent");
		pointer(handle, "pointerdown", 400, 0);
		pointer(handle, "pointermove", 340, 1000);
		pointer(handle, "pointerup", 340, 1000);
		await flush();
		expect({before, after: menu.getAttribute("data-cds-sheet-detent"), height: menu.style.height}).toStrictEqual({
			before: "default",
			after: "tall",
			height: "calc(0.9 * (100dvh - env(safe-area-inset-top, 0px)))",
		});
	});

	it("never starts a drag from a menu item", async () => {
		stubCoarseAtWidth(639);
		stubSheetRects();
		renderDropdown();
		const menu = await openDropdown();
		const item = screen.getByRole("menuitem", {name: /Copy link/});
		pointer(item, "pointerdown", 400, 0);
		pointer(item, "pointermove", 600, 1000);
		expect(dragStyles([menu])).toStrictEqual({levels: [{translate: "", height: ""}], scrim: ""});
	});

	it("drags every level of the tree from a drilled level's header", async () => {
		stubSheetRects();
		const {root, child} = await drillIntoStatus();
		if (child === undefined) throw new Error("no drilled level");
		const header = child.querySelector("[data-cds-sheet-scroll]")?.nextElementSibling;
		if (header === null || header === undefined) throw new Error("no header");
		pointer(header, "pointerdown", 400, 0);
		pointer(header, "pointermove", 500, 1000);
		expect(dragStyles([root, child])).toStrictEqual({
			levels: [
				{translate: "0 100px", height: "400px"},
				{translate: "0 100px", height: "400px"},
			],
			scrim: "0.75",
		});
	});
	it("swallows Tab and Shift+Tab inside a sheet, as upstream's Pt, and keeps it open", async () => {
		stubCoarseAtWidth(639);
		renderDropdown();
		const menu = await openDropdown();
		const tab = fireEvent.keyDown(menu, {key: "Tab"});
		const shiftTab = fireEvent.keyDown(menu, {key: "Tab", shiftKey: true});
		await flush();
		expect({
			tabPrevented: !tab,
			shiftTabPrevented: !shiftTab,
			open: screen.queryByRole("menu") !== null,
		}).toStrictEqual({tabPrevented: true, shiftTabPrevented: true, open: true});
	});

	it("leaves Tab to Base UI in an anchored menu", async () => {
		stubCoarseAtWidth(1024);
		renderDropdown();
		const menu = await openDropdown();
		expect(fireEvent.keyDown(menu, {key: "Tab"})).toBe(true);
	});

	it("still closes a sheet on Escape", async () => {
		stubCoarseAtWidth(639);
		const onOpenChange = renderControlledSheet();
		const menu = await openDropdown();
		fireEvent.keyDown(menu, {key: "Escape"});
		await flush();
		expect(onOpenChange.mock.calls.map(([open]) => open)).toStrictEqual([true, false]);
	});

	it("highlights the Close row on ArrowDown past the last real item", async () => {
		stubCoarseAtWidth(639);
		renderDropdown();
		await openDropdown();
		const items = screen.getAllByRole("menuitem");
		const last = items.at(-2);
		const close = items.at(-1);
		if (last === undefined || close === undefined) throw new Error("no items");
		act(() => {
			last.focus();
		});
		fireEvent.keyDown(last, {key: "ArrowDown"});
		await flush();
		expect({
			highlighted: close.hasAttribute("data-highlighted"),
			srOnly: close.matches(":not(:focus-visible):not([data-highlighted]):not([data-cds-sheet-control-held])"),
		}).toStrictEqual({highlighted: true, srOnly: false});
	});
});

describe("Menu under fizzy-lake panels on a fine pointer", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/** The classes a panels-fine (fizzy-lake panels, fine pointer) media rule adds. */
	function panelsFine(element: Element | null | undefined): string[] {
		return (element?.className ?? "").split(" ").filter((name) => name.startsWith("panels-fine:"));
	}

	function anatomy() {
		const menu = screen.getByRole("menu");
		return {
			popup: panelsFine(menu),
			scroller: panelsFine(menu.querySelector("[data-menu-scroller]")),
			rows: [
				screen.getByRole("menuitem", {name: /Status/}),
				screen.getByRole("menuitem", {name: /Copy link/}),
				screen.getByRole("menuitemcheckbox", {name: "Show PR status"}),
			].map(panelsFine),
		};
	}

	it("sizes comfortable menus like upstream's Filter and sort: 28px rows with 4px block pads, a 6px gutter, a 14px popup radius", async () => {
		render(
			<Menu>
				<MenuTrigger aria-label="More options">...</MenuTrigger>
				<MenuContent>
					<RowMenuBody onCopy={vi.fn<() => void>()} onDelete={vi.fn<() => void>()} />
				</MenuContent>
			</Menu>,
		);
		await openDropdown();

		expect(anatomy()).toStrictEqual({
			popup: ["panels-fine:rounded-menu-comfortable"],
			scroller: ["panels-fine:p-1.5"],
			rows: Array.from({length: 3}, () => ["panels-fine:h-7", "panels-fine:py-1"]),
		});
	});

	it("leaves compact menus on their classic metrics", async () => {
		renderDropdown();
		await openDropdown();

		expect(anatomy()).toStrictEqual({popup: [], scroller: [], rows: [[], [], []]});
	});

	it("leaves a coarse-pointer sheet on its lg rows", async () => {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
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
		renderDropdown();
		await openDropdown();
		const menu = screen.getByRole("menu");

		expect({
			presentation: menu.getAttribute("data-presentation"),
			popup: panelsFine(menu),
			rows: [
				screen.getByRole("menuitem", {name: /Copy link/}),
				screen.getByRole("menuitemcheckbox", {name: "Show PR status"}),
			].map(panelsFine),
		}).toStrictEqual({presentation: "sheet", popup: [], rows: [[], []]});
	});
});
