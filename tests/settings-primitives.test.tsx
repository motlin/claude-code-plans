// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {SegmentedControl} from "../src/components/settings/segmented-control";
import {SettingsRow, SettingsSection} from "../src/components/settings/settings-row";
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
		name: radio.textContent ?? radio.getAttribute("aria-label") ?? "",
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
});

describe("SegmentedControl", () => {
	it("exposes a radiogroup with a single tab stop on the checked radio", () => {
		render(<ControlledSegmented />);

		expect({
			group: screen.getByRole("radiogroup", {name: "Default transcript view"}) !== null,
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

		fireEvent.change(screen.getByRole("searchbox", {name: "Search Light code theme"}), {
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
			name: "Search Light code theme",
		});

		fireEvent.change(search, {target: {value: "sol"}});
		const filtered = within(screen.getByRole("listbox"))
			.getAllByRole("option")
			.map((option) => ({
				name: option.textContent,
				selected: option.getAttribute("aria-selected"),
			}));
		fireEvent.keyDown(search, {key: "Enter"});

		expect({
			filtered,
			chosen: screen.getByRole("status", {name: "Chosen theme"}).textContent,
			listbox: screen.queryByRole("listbox"),
			trigger: screen.getByRole("combobox", {name: "Light code theme"}).textContent,
		}).toStrictEqual({
			filtered: [{name: "Solarized Light", selected: "false"}],
			chosen: "solarized-light",
			listbox: null,
			trigger: "Solarized Light",
		});
	});

	it("moves the active option with arrow keys before Enter", () => {
		render(<ControlledCombobox />);
		fireEvent.click(screen.getByRole("combobox", {name: "Light code theme"}));
		const search = screen.getByRole("searchbox", {
			name: "Search Light code theme",
		});

		fireEvent.keyDown(search, {key: "ArrowDown"});
		fireEvent.keyDown(search, {key: "ArrowDown"});
		fireEvent.keyDown(search, {key: "ArrowUp"});
		fireEvent.keyDown(search, {key: "Enter"});

		expect(screen.getByRole("status", {name: "Chosen theme"}).textContent).toBe("github-light");
	});
});
