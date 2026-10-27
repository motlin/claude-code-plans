// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {SegmentedControl} from "../src/components/settings/segmented-control";
import {SettingsRow, SettingsSection} from "../src/components/settings/settings-row";
import {SettingsTabContext} from "../src/components/settings/settings-row-context";
import {Switch} from "../src/components/settings/switch";
import {ThemedCombobox} from "../src/components/settings/themed-combobox";

afterEach(() => {
	cleanup();
});

function ControlledSwitchRow() {
	const [checked, setChecked] = useState(false);
	return (
		<SettingsSection title="Notifications">
			<SettingsRow
				slug="response-completions"
				title="Response completions"
				description="Get notified when Claude has finished a response."
			>
				<Switch checked={checked} onCheckedChange={setChecked} />
			</SettingsRow>
		</SettingsSection>
	);
}

const VIEW_OPTIONS = [
	{value: "normal", label: "Normal"},
	{value: "thinking", label: "Thinking"},
	{value: "verbose", label: "Verbose"},
] as const;

function ControlledSegmented() {
	const [value, setValue] = useState<"normal" | "thinking" | "verbose">("normal");
	return (
		<SegmentedControl
			aria-label="Default transcript view"
			value={value}
			onValueChange={setValue}
			options={VIEW_OPTIONS}
		/>
	);
}

const THEME_OPTIONS = [
	{value: "claude-light", label: "Claude Light"},
	{value: "github-light", label: "GitHub Light"},
	{value: "one-light", label: "One Light"},
	{value: "solarized-light", label: "Solarized Light"},
];

function ControlledCombobox() {
	const [value, setValue] = useState("claude-light");
	return (
		<>
			<ThemedCombobox
				aria-label="Light code theme"
				value={value}
				onValueChange={setValue}
				options={THEME_OPTIONS}
			/>
			<output aria-label="Chosen theme">{value}</output>
		</>
	);
}

function radioStates(): Array<{
	name: string;
	checked: string | null;
	tabIndex: number;
}> {
	return screen.getAllByRole("radio").map((radio) => ({
		name: radio.textContent,
		checked: radio.getAttribute("aria-checked"),
		tabIndex: radio.tabIndex,
	}));
}

describe("SettingsSection and SettingsRow", () => {
	it("renders an upstream-shaped section heading and labelled row group", () => {
		render(<ControlledSwitchRow />);

		const heading = screen.getByRole("heading", {level: 3});
		const group = screen.getByRole("group", {
			name: "Response completions",
			description: "Get notified when Claude has finished a response.",
		});
		const toggle = within(group).getByRole("switch", {
			name: "Response completions",
		});

		expect({
			heading: heading.textContent,
			headingSize: heading.classList.contains("text-[15px]"),
			row: group.getAttribute("data-settings-row"),
			control: toggle.closest("[data-settings-control]") !== null,
		}).toStrictEqual({
			heading: "Notifications",
			headingSize: true,
			row: "response-completions",
			control: true,
		});
	});

	it("renders upstream's section header and row hooks", () => {
		render(
			<SettingsTabContext.Provider value="general">
				<SettingsSection id="notifications" title="Notifications" subtitle="How Claude gets your attention.">
					<SettingsRow slug="response-completions" title="Response completions" />
				</SettingsSection>
			</SettingsTabContext.Provider>,
		);

		const section = document.querySelector("section");
		const header = section?.firstElementChild;
		const titles = header?.firstElementChild;
		const heading = titles?.firstElementChild;
		const subtitle = titles?.lastElementChild;
		const row = screen.getByRole("group", {name: "Response completions"});
		const classes = (element: Element | null | undefined) => element?.className.split(" ");

		expect({
			section: {id: section?.id, titled: section?.getAttribute("data-settings-section-titled")},
			header: {hook: header?.getAttribute("data-settings-group-header"), classes: classes(header)},
			titles: classes(titles),
			heading: {
				tag: heading?.tagName,
				hook: heading?.getAttribute("data-settings-group-title"),
				classes: classes(heading),
			},
			subtitle: {text: subtitle?.textContent, classes: classes(subtitle)},
			row: {
				id: row.id,
				item: row.getAttribute("data-settings-item"),
				slug: row.getAttribute("data-settings-row"),
				groupSetting: row.classList.contains("group/setting"),
			},
		}).toStrictEqual({
			section: {id: "notifications", titled: ""},
			header: {hook: "", classes: ["mb-4", "flex", "items-start", "justify-between", "gap-7"]},
			titles: ["flex", "min-w-0", "flex-col", "gap-1"],
			heading: {
				tag: "H3",
				hook: "",
				classes: [
					"settings-row-title",
					"self-start",
					"text-[15px]",
					"leading-[20px]",
					"font-[580]",
					"text-primary",
					"outline-none",
				],
			},
			subtitle: {
				text: "How Claude gets your attention.",
				classes: ["text-footnote", "text-secondary"],
			},
			row: {
				id: "setting-general-response-completions",
				item: "",
				slug: "response-completions",
				groupSetting: true,
			},
		});
	});

	it("omits the subtitle and row id outside a settings tab", () => {
		render(
			<SettingsSection id="notifications" title="Notifications">
				<SettingsRow slug="response-completions" title="Response completions" />
			</SettingsSection>,
		);

		expect({
			titles: document.querySelector("[data-settings-group-header] > div")?.childElementCount,
			rowId: screen.getByRole("group", {name: "Response completions"}).getAttribute("id"),
		}).toStrictEqual({titles: 1, rowId: null});
	});

	// Locks today's comfortable spacing: the Settings dialog is comfortable for every web user
	// (density-default-tokens), so upstream's mb-xl / gap-lg / py-md resolve to 40 / 28 / 12px.
	it("keeps the comfortable section and row spacing", () => {
		render(<ControlledSwitchRow />);

		const heading = screen.getByRole("heading", {level: 3});
		const group = screen.getByRole("group", {name: "Response completions"});
		const pick = (element: Element | null, names: string[]) =>
			names.filter((name) => element?.classList.contains(name));

		expect({
			section: pick(heading.closest("section"), ["mb-10", "last:mb-0"]),
			header: pick(heading.closest("[data-settings-group-header]"), ["mb-4"]),
			row: pick(group, ["gap-7", "py-3"]),
		}).toStrictEqual({
			section: ["mb-10", "last:mb-0"],
			header: ["mb-4"],
			row: ["gap-7", "py-3"],
		});
	});
});

describe("Switch", () => {
	it("toggles with Space and Enter and exposes aria-checked", () => {
		render(<ControlledSwitchRow />);
		const toggle = screen.getByRole("switch", {name: "Response completions"});

		const states: Array<string | null> = [toggle.getAttribute("aria-checked")];
		fireEvent.keyDown(toggle, {key: " "});
		states.push(toggle.getAttribute("aria-checked"));
		fireEvent.keyDown(toggle, {key: "Enter"});
		states.push(toggle.getAttribute("aria-checked"));
		fireEvent.click(toggle);
		states.push(toggle.getAttribute("aria-checked"));

		expect({states, tabIndex: toggle.tabIndex}).toStrictEqual({
			states: ["false", "true", "false", "true"],
			tabIndex: 0,
		});
	});

	it("ignores input while disabled", () => {
		render(<Switch checked={false} onCheckedChange={() => {}} disabled aria-label="Locked" />);
		const toggle = screen.getByRole("switch", {name: "Locked"});
		fireEvent.keyDown(toggle, {key: " "});
		fireEvent.click(toggle);

		expect({
			checked: toggle.getAttribute("aria-checked"),
			disabled: toggle.getAttribute("aria-disabled"),
			tabIndex: toggle.tabIndex,
		}).toStrictEqual({checked: "false", disabled: "true", tabIndex: -1});
	});

	it("fills upstream's fill-accent #2a78d6 when on, fill-accent-hover #3987e5 on hover, and dims to opacity-disabled .4", () => {
		render(<Switch checked onCheckedChange={() => {}} aria-label="Accent" />);
		const classes = screen.getByRole("switch", {name: "Accent"}).className.split(" ");

		expect({
			checked: classes.includes("data-[checked]:bg-[#2a78d6]"),
			checkedHover: classes.includes("data-[checked]:hover:bg-[#3987e5]"),
			disabledCheckedHover: classes.includes("data-[checked]:data-[disabled]:hover:bg-[#2a78d6]"),
			disabled: classes.includes("data-[disabled]:opacity-40"),
			legacyAccent: classes.includes("data-[checked]:bg-accent-100"),
			legacyDisabled: classes.includes("data-[disabled]:opacity-50"),
		}).toStrictEqual({
			checked: true,
			checkedHover: true,
			disabledCheckedHover: true,
			disabled: true,
			legacyAccent: false,
			legacyDisabled: false,
		});
	});

	it("slides the knob with upstream's duration-snap ease-overshoot (120ms cubic-bezier(0.34,1.3,0.64,1)), off under reduced motion", () => {
		render(<Switch checked onCheckedChange={() => {}} aria-label="Knob" />);
		const knob = screen.getByRole("switch", {name: "Knob"}).firstElementChild;
		const classes = knob?.className.split(" ") ?? [];

		expect({
			transition: classes.includes("transition-transform"),
			duration: classes.includes("duration-[120ms]"),
			easing: classes.includes("ease-[cubic-bezier(0.34,1.3,0.64,1)]"),
			reduced: classes.includes("motion-reduce:transition-none"),
		}).toStrictEqual({transition: true, duration: true, easing: true, reduced: true});
	});
});

describe("SegmentedControl", () => {
	it("exposes a radiogroup with a single tab stop on the checked radio", () => {
		render(<ControlledSegmented />);

		expect({
			group: screen.queryByRole("radiogroup", {name: "Default transcript view"}) !== null,
			radios: radioStates(),
		}).toStrictEqual({
			group: true,
			radios: [
				{name: "Normal", checked: "true", tabIndex: 0},
				{name: "Thinking", checked: "false", tabIndex: -1},
				{name: "Verbose", checked: "false", tabIndex: -1},
			],
		});
	});

	it("moves the checked radio and focus with arrow keys, wrapping at the ends", () => {
		render(<ControlledSegmented />);
		const normal = screen.getByRole("radio", {name: "Normal"});
		normal.focus();

		const trail: Array<{checked: string; focused: string}> = [];
		const snapshot = () => {
			const checked = screen.getAllByRole("radio").find((radio) => radio.getAttribute("aria-checked") === "true");
			trail.push({
				checked: checked?.textContent ?? "",
				focused: document.activeElement?.textContent ?? "",
			});
		};

		fireEvent.keyDown(document.activeElement ?? normal, {key: "ArrowRight"});
		snapshot();
		fireEvent.keyDown(document.activeElement ?? normal, {key: "ArrowDown"});
		snapshot();
		fireEvent.keyDown(document.activeElement ?? normal, {key: "ArrowRight"});
		snapshot();
		fireEvent.keyDown(document.activeElement ?? normal, {key: "ArrowLeft"});
		snapshot();
		fireEvent.keyDown(document.activeElement ?? normal, {key: "End"});
		snapshot();
		fireEvent.keyDown(document.activeElement ?? normal, {key: "Home"});
		snapshot();

		expect(trail).toStrictEqual([
			{checked: "Thinking", focused: "Thinking"},
			{checked: "Verbose", focused: "Verbose"},
			{checked: "Normal", focused: "Normal"},
			{checked: "Verbose", focused: "Verbose"},
			{checked: "Verbose", focused: "Verbose"},
			{checked: "Normal", focused: "Normal"},
		]);
	});

	it("labels icon-only items with aria-label", () => {
		render(
			<SegmentedControl
				aria-label="Theme"
				value="system"
				onValueChange={() => {}}
				options={[
					{
						value: "system",
						label: "System",
						icon: <svg data-testid="icon-system" />,
					},
					{
						value: "light",
						label: "Light",
						icon: <svg data-testid="icon-light" />,
					},
					{
						value: "dark",
						label: "Dark",
						icon: <svg data-testid="icon-dark" />,
					},
				]}
				iconOnly
			/>,
		);

		expect(
			screen.getAllByRole("radio").map((radio) => ({
				label: radio.getAttribute("aria-label"),
				text: radio.textContent,
				checked: radio.getAttribute("aria-checked"),
			})),
		).toStrictEqual([
			{label: "System", text: "", checked: "true"},
			{label: "Light", text: "", checked: "false"},
			{label: "Dark", text: "", checked: "false"},
		]);
	});
});

describe("ThemedCombobox", () => {
	it("opens a filterable listbox with a check on the current option", () => {
		render(<ControlledCombobox />);
		const trigger = screen.getByRole("combobox", {name: "Light code theme"});
		const closed = {
			text: trigger.textContent,
			expanded: trigger.getAttribute("aria-expanded"),
			haspopup: trigger.getAttribute("aria-haspopup"),
		};

		fireEvent.click(trigger);
		const listbox = screen.getByRole("listbox", {name: "Light code theme"});
		const options = () =>
			within(listbox)
				.getAllByRole("option")
				.map((option) => ({
					name: option.textContent,
					selected: option.getAttribute("aria-selected"),
				}));
		const initial = options();

		fireEvent.change(screen.getByRole("searchbox", {name: "Light code theme"}), {
			target: {value: "e li"},
		});
		const filtered = options();

		expect({
			closed,
			expanded: trigger.getAttribute("aria-expanded"),
			initial,
			filtered,
		}).toStrictEqual({
			closed: {text: "Claude Light", expanded: "false", haspopup: "listbox"},
			expanded: "true",
			initial: [
				{name: "Claude Light", selected: "true"},
				{name: "GitHub Light", selected: "false"},
				{name: "One Light", selected: "false"},
				{name: "Solarized Light", selected: "false"},
			],
			filtered: [
				{name: "Claude Light", selected: "true"},
				{name: "One Light", selected: "false"},
			],
		});
	});

	it("narrows the options by the filter and selects the active one with Enter", () => {
		render(<ControlledCombobox />);
		fireEvent.click(screen.getByRole("combobox", {name: "Light code theme"}));
		const search = screen.getByRole("searchbox", {
			name: "Light code theme",
		});

		fireEvent.change(search, {target: {value: "sol"}});
		const filtered = within(screen.getByRole("listbox"))
			.getAllByRole("option")
			.map((option) => ({
				name: option.textContent,
				selected: option.getAttribute("aria-selected"),
			}));
		const highlightedAfterTyping = screen
			.queryAllByRole("option")
			.filter((option) => option.hasAttribute("data-highlighted"));
		fireEvent.keyDown(search, {key: "ArrowDown"});
		const highlightedAfterArrow = screen
			.getAllByRole("option")
			.filter((option) => option.hasAttribute("data-highlighted"))
			.map((option) => option.textContent);
		fireEvent.keyDown(search, {key: "Enter"});

		expect({
			highlightedAfterTyping,
			highlightedAfterArrow,
			filtered,
			chosen: screen.getByRole("status", {name: "Chosen theme"}).textContent,
			listbox: screen.queryByRole("listbox"),
			trigger: screen.getByRole("combobox", {name: "Light code theme"}).textContent,
		}).toStrictEqual({
			highlightedAfterTyping: [],
			highlightedAfterArrow: ["Solarized Light"],
			filtered: [{name: "Solarized Light", selected: "false"}],
			chosen: "solarized-light",
			listbox: null,
			trigger: "Solarized Light",
		});
	});

	it("labels the filter input like the combobox, with no placeholder", () => {
		render(<ControlledCombobox />);
		fireEvent.click(screen.getByRole("combobox", {name: "Light code theme"}));
		const search = screen.getByRole("searchbox");

		expect({
			label: search.getAttribute("aria-label"),
			placeholder: search.getAttribute("placeholder"),
		}).toStrictEqual({label: "Light code theme", placeholder: null});
	});

	it("shows No results when the filter matches nothing, and Enter picks nothing", () => {
		render(<ControlledCombobox />);
		fireEvent.click(screen.getByRole("combobox", {name: "Light code theme"}));
		const search = screen.getByRole("searchbox", {name: "Light code theme"});

		fireEvent.change(search, {target: {value: "zzz"}});
		const listbox = screen.getByRole("listbox", {name: "Light code theme"});
		const empty = {text: listbox.textContent, options: within(listbox).queryAllByRole("option")};
		fireEvent.change(search, {target: {value: "light"}});
		fireEvent.keyDown(search, {key: "Enter"});

		expect({
			empty,
			chosen: screen.getByRole("status", {name: "Chosen theme"}).textContent,
		}).toStrictEqual({
			empty: {text: "No results", options: []},
			chosen: "claude-light",
		});
	});

	it("moves the active option with arrow keys before Enter", () => {
		render(<ControlledCombobox />);
		fireEvent.click(screen.getByRole("combobox", {name: "Light code theme"}));
		const search = screen.getByRole("searchbox", {
			name: "Light code theme",
		});

		fireEvent.keyDown(search, {key: "ArrowDown"});
		fireEvent.keyDown(search, {key: "ArrowDown"});
		fireEvent.keyDown(search, {key: "ArrowUp"});
		fireEvent.keyDown(search, {key: "Enter"});

		expect(screen.getByRole("status", {name: "Chosen theme"}).textContent).toBe("github-light");
	});
});
