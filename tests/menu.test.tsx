// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

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
		<Menu>
			<MenuTrigger aria-label="More options">...</MenuTrigger>
			<MenuContent>
				<RowMenuBody {...handlers} />
			</MenuContent>
		</Menu>,
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
			container: ["rounded-r7", "p-1"],
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
			popups: Array.from({length: 2}, () => ["rounded-card", "p-1", "text-[14px]/[20px]"]),
			items: Array.from({length: 4}, () => densityClasses),
			separator: "mx-2.5 my-1 h-px bg-border",
			expanded: "true",
		});
	});

	it("sizes leading icons like upstream's size:auto glyphs: 20px in comfortable menus, 16px in compact", async () => {
		const glyphSize = async (density: "compact" | "comfortable") => {
			render(
				<Menu>
					<MenuTrigger aria-label="More options">...</MenuTrigger>
					<MenuContent density={density}>
						<MenuItem icon={<svg data-testid="glyph" />}>Routines</MenuItem>
					</MenuContent>
				</Menu>,
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

	it("places a submenu level with its trigger and 2px right of the parent", async () => {
		renderDropdown();
		await openDropdown();
		const trigger = screen.getByRole("menuitem", {name: /Status/});

		act(() => {
			trigger.focus();
		});
		fireEvent.keyDown(trigger, {key: "ArrowRight"});
		await flush();
		const positioner = screen.getAllByRole("menu")[1]?.parentElement;

		expect({
			side: positioner?.getAttribute("data-side-offset"),
			align: positioner?.getAttribute("data-align-offset"),
		}).toEqual({side: "2", align: "0"});
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
			<Menu defaultOpen>
				<MenuTrigger aria-label="Mode">Mode</MenuTrigger>
				<MenuContent>
					<MenuRadioGroup value="auto">
						<MenuRadioItem value="auto" accelerator="1">
							Auto
						</MenuRadioItem>
						<MenuRadioItem value="plan" accelerator="2">
							Plan
						</MenuRadioItem>
					</MenuRadioGroup>
				</MenuContent>
			</Menu>,
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
				"inline-flex shrink-0 items-baseline gap-[0.3em] text-caption [&>kbd]:leading-[15px] pointer-coarse:hidden",
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
		fireEvent.keyDown(menu, {key: "c"});
		await flush();
		expect(onCopy).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("menu")).toBeNull();
	});
});
