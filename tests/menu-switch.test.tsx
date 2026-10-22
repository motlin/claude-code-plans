// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {DensityScope} from "../src/components/ui/density";
import {Menu, MenuContent, MenuItem, MenuSwitchItem, MenuTrigger} from "../src/components/ui/menu";
import {MenuSwitch} from "../src/components/ui/menu-switch";

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

function attributes(element: Element | null) {
	if (element === null) return null;
	return Object.fromEntries(
		Array.from(element.attributes)
			.filter((attribute) => attribute.name !== "class")
			.map((attribute) => [attribute.name, attribute.value]),
	);
}

const TRACK_CLASS =
	"relative inline-flex h-[14px] w-[25.2px] shrink-0 rounded-full p-[2px] bg-[var(--menu-switch-track)] hover:bg-[var(--menu-switch-track-hover)] data-[checked]:bg-accent-100 data-[disabled]:opacity-40 forced-colors:border forced-colors:border-solid forced-colors:border-[CanvasText] forced-colors:p-px forced-colors:data-[checked]:border-[Highlight] forced-colors:data-[checked]:!bg-[Highlight]";
const KNOB_CLASS =
	"block size-[10px] rounded-full bg-white shadow-[0_1px_2px_0_rgb(11_11_11/0.06),0_2px_8px_0_rgb(0_0_0/0.24)] transition-transform duration-[120ms] ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none forced-colors:bg-[CanvasText] forced-colors:data-[checked]:bg-[HighlightText] data-[checked]:translate-x-[11.2px] rtl:data-[checked]:-translate-x-[11.2px]";

describe("MenuSwitch", () => {
	it("renders upstream's xs switch off, with its track and knob classes", () => {
		render(<MenuSwitch checked={false} aria-label="Worktree" />);
		const track = screen.getByRole("switch", {name: "Worktree"});

		expect({
			track: attributes(track),
			trackClass: track.className,
			knob: attributes(track.firstElementChild),
			knobClass: track.firstElementChild?.className,
		}).toStrictEqual({
			track: {
				role: "switch",
				tabindex: "-1",
				"aria-checked": "false",
				"aria-label": "Worktree",
				"data-size": "xs",
				"data-unchecked": "",
			},
			trackClass: TRACK_CLASS,
			knob: {"aria-hidden": "true", "data-unchecked": ""},
			knobClass: KNOB_CLASS,
		});
	});

	it("marks the track and the knob data-checked when on", () => {
		render(<MenuSwitch checked aria-label="Worktree" />);
		const track = screen.getByRole("switch", {name: "Worktree"});

		expect({track: attributes(track), knob: attributes(track.firstElementChild)}).toStrictEqual({
			track: {
				role: "switch",
				tabindex: "-1",
				"aria-checked": "true",
				"aria-label": "Worktree",
				"data-size": "xs",
				"data-checked": "",
			},
			knob: {"aria-hidden": "true", "data-checked": ""},
		});
	});

	it("adds aria-disabled and data-disabled when disabled, and aria-readonly when read-only", () => {
		render(
			<>
				<MenuSwitch checked={false} disabled aria-label="Disabled" />
				<MenuSwitch checked readOnly aria-label="Read only" />
			</>,
		);

		expect({
			disabled: attributes(screen.getByRole("switch", {name: "Disabled"})),
			readOnly: attributes(screen.getByRole("switch", {name: "Read only"})),
		}).toStrictEqual({
			disabled: {
				role: "switch",
				tabindex: "-1",
				"aria-checked": "false",
				"aria-label": "Disabled",
				"aria-disabled": "true",
				"data-size": "xs",
				"data-unchecked": "",
				"data-disabled": "",
			},
			readOnly: {
				role: "switch",
				tabindex: "-1",
				"aria-checked": "true",
				"aria-label": "Read only",
				"aria-readonly": "true",
				"data-size": "xs",
				"data-checked": "",
			},
		});
	});
});

function SwitchMenu({onChange, disabled = false}: {onChange: (checked: boolean) => void; disabled?: boolean}) {
	const [on, setOn] = useState(false);
	return (
		<DensityScope density="compact">
			<Menu>
				<MenuTrigger aria-label="Folder">...</MenuTrigger>
				<MenuContent>
					<MenuItem>eclipse-collections</MenuItem>
					<MenuSwitchItem
						checked={on}
						disabled={disabled}
						onCheckedChange={(next) => {
							setOn(next);
							onChange(next);
						}}
					>
						Worktree
					</MenuSwitchItem>
				</MenuContent>
			</Menu>
		</DensityScope>
	);
}

async function openMenu() {
	fireEvent.click(screen.getByRole("button", {name: "Folder"}));
	await flush();
	return screen.getByRole("menu");
}

describe("MenuSwitchItem", () => {
	it("is a plain menuitem whose trailing xs switch carries the state", async () => {
		render(<SwitchMenu onChange={() => {}} />);
		await openMenu();
		const item = screen.getByRole("menuitem", {name: /^Worktree/});
		const label = item.firstElementChild;
		const trailing = item.lastElementChild;

		expect({
			ariaChecked: item.getAttribute("aria-checked"),
			itemClasses: item.className
				.split(" ")
				.filter((c) => ["h-6", "px-2", "py-[2.5px]", "text-[13px]/[19px]", "gap-1.5"].includes(c)),
			label: [label?.className, label?.textContent],
			trailing: trailing?.className,
			switch: attributes(trailing?.querySelector('[role="switch"]') ?? null),
		}).toStrictEqual({
			ariaChecked: null,
			itemClasses: ["h-6", "gap-1.5", "px-2", "py-[2.5px]", "text-[13px]/[19px]"],
			label: ["min-w-0 flex-1 truncate", "Worktree"],
			trailing: "ms-3 flex shrink-0 items-center gap-1.5",
			switch: {
				role: "switch",
				tabindex: "-1",
				"aria-checked": "false",
				"aria-label": "Worktree",
				"data-size": "xs",
				"data-unchecked": "",
			},
		});
	});

	it("toggles on click and on Enter while the menu stays open", async () => {
		const onChange = vi.fn<(checked: boolean) => void>();
		render(<SwitchMenu onChange={onChange} />);
		await openMenu();
		const item = screen.getByRole("menuitem", {name: /^Worktree/});
		fireEvent.click(item);
		await flush();
		act(() => {
			item.focus();
		});
		fireEvent.keyDown(item, {key: "Enter"});
		await flush();

		expect({
			calls: onChange.mock.calls,
			open: screen.queryByRole("menu") !== null,
			checked: screen.getByRole("switch", {name: "Worktree"}).getAttribute("aria-checked"),
		}).toStrictEqual({calls: [[true], [false]], open: true, checked: "false"});
	});

	it("disables the item and its switch together", async () => {
		const onChange = vi.fn<(checked: boolean) => void>();
		render(<SwitchMenu onChange={onChange} disabled />);
		await openMenu();
		const item = screen.getByRole("menuitem", {name: /^Worktree/});
		fireEvent.click(item);
		await flush();
		const toggle = screen.getByRole("switch", {name: "Worktree"});

		expect({
			calls: onChange.mock.calls,
			item: [item.getAttribute("aria-disabled"), item.hasAttribute("data-disabled")],
			switch: [toggle.getAttribute("aria-disabled"), toggle.hasAttribute("data-disabled")],
		}).toStrictEqual({calls: [], item: ["true", true], switch: ["true", true]});
	});
});
