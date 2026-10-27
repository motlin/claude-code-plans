// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SettingsProvider} from "../src/components/settings-provider";
import {GeneralSettings} from "../src/components/settings/settings-sections";
import {ThemeProvider} from "../src/components/theme-provider";
import {installLocalStorage} from "./fake-storage";

function stubNotification(permission: NotificationPermission) {
	const requestPermission = vi.fn<typeof Notification.requestPermission>(async () => Promise.resolve(permission));
	vi.stubGlobal(
		"Notification",
		Object.assign(function Notification() {}, {permission, requestPermission}),
	);
	return requestPermission;
}

async function renderGeneral() {
	render(
		<ThemeProvider>
			<SettingsProvider>
				<GeneralSettings />
			</SettingsProvider>
		</ThemeProvider>,
	);
	await act(async () => {});
}

function radios(groupName: string) {
	const group = screen.getByRole("radiogroup", {name: groupName});
	return within(group)
		.getAllByRole("radio")
		.map((radio) => ({
			name: radio.getAttribute("aria-label") ?? radio.textContent,
			checked: radio.getAttribute("aria-checked"),
		}));
}

function switchState(name: string) {
	const control = screen.getByRole("switch", {name});
	return {
		checked: control.getAttribute("aria-checked"),
		disabled: control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true",
	};
}

beforeEach(() => {
	installLocalStorage();
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({matches: false, addEventListener: () => {}, removeEventListener: () => {}})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	document.documentElement.removeAttribute("data-motion");
	document.documentElement.classList.remove("light", "dark");
});

describe("General settings ▸ Appearance", () => {
	it("renders Theme, Transcript text size, Transcript width, then Motion with the upstream width description", async () => {
		stubNotification("granted");
		await renderGeneral();

		const appearance = screen.getByRole("heading", {name: "Appearance"}).closest("section");
		const rows = [...(appearance?.querySelectorAll("[data-settings-row]") ?? [])];
		expect({
			order: rows.map((row) => row.getAttribute("data-settings-row")).slice(0, 4),
			description: document.querySelector('[data-settings-row="transcript-width"] [data-settings-desc]')
				?.textContent,
			width: radios("Transcript width"),
		}).toStrictEqual({
			order: ["theme", "transcript-text-size", "transcript-width", "motion"],
			description: "Maximum width of the transcript and composer columns.",
			width: [
				{name: "Narrow", checked: "true"},
				{name: "Medium", checked: "false"},
				{name: "Wide", checked: "false"},
			],
		});
	});

	it("leaves out upstream's not-applicable rows and keeps exactly the five Appearance rows in order", async () => {
		stubNotification("granted");
		await renderGeneral();

		const appearance = screen.getByRole("heading", {name: "Appearance"}).closest("section");
		const titles = (scope: HTMLElement) =>
			within(scope)
				.queryAllByRole("group")
				.filter((group) => group.hasAttribute("data-settings-row"))
				.map((group) => group.querySelector(".settings-row-title")?.textContent);
		const allTitles = titles(document.body);

		expect({
			appearance: appearance === null ? null : titles(appearance),
			notApplicable: ["Chat font", "Preferred browser", "Language", "Style", "Speed"].filter((title) =>
				allTitles.includes(title),
			),
		}).toStrictEqual({
			appearance: ["Theme", "Transcript text size", "Transcript width", "Motion", "Hide chrome"],
			notApplicable: [],
		});
	});

	it("renders Theme as icon-only System/Light/Dark radios bound to the theme provider", async () => {
		stubNotification("granted");
		await renderGeneral();

		expect(radios("Theme")).toStrictEqual([
			{name: "System", checked: "true"},
			{name: "Light", checked: "false"},
			{name: "Dark", checked: "false"},
		]);

		fireEvent.click(screen.getByRole("radio", {name: "Dark"}));

		expect({
			radios: radios("Theme"),
			stored: localStorage.getItem("theme"),
			dark: document.documentElement.classList.contains("dark"),
		}).toStrictEqual({
			radios: [
				{name: "System", checked: "false"},
				{name: "Light", checked: "false"},
				{name: "Dark", checked: "true"},
			],
			stored: "dark",
			dark: true,
		});
	});

	it("sets html[data-motion=reduced] from the Motion control and clears it for System", async () => {
		stubNotification("granted");
		await renderGeneral();

		expect(radios("Motion")).toStrictEqual([
			{name: "System", checked: "true"},
			{name: "Reduced", checked: "false"},
		]);

		fireEvent.click(within(screen.getByRole("radiogroup", {name: "Motion"})).getByText("Reduced"));
		const reduced = {
			attribute: document.documentElement.getAttribute("data-motion"),
			stored: localStorage.getItem("ccp-motion"),
		};

		fireEvent.click(within(screen.getByRole("radiogroup", {name: "Motion"})).getByText("System"));

		expect({
			reduced,
			system: document.documentElement.getAttribute("data-motion"),
		}).toStrictEqual({
			reduced: {attribute: "reduced", stored: "reduced"},
			system: null,
		});
	});

	it("renders Appearance without a Status footer row", async () => {
		stubNotification("granted");
		await renderGeneral();

		expect({
			switch: screen.queryByRole("switch", {name: "Status footer"}),
			title: screen.queryByText("Status footer"),
			hideChrome: switchState("Hide chrome"),
		}).toStrictEqual({
			switch: null,
			title: null,
			hideChrome: {checked: "false", disabled: false},
		});
	});

	it("loads a saved config that still holds the retired status footer key and drops that key", async () => {
		stubNotification("granted");
		localStorage.setItem("ccp-status-footer", "false");
		localStorage.setItem("ccp-chrome-hidden", "true");
		await renderGeneral();

		expect({
			hideChrome: switchState("Hide chrome"),
			statusFooter: localStorage.getItem("ccp-status-footer"),
		}).toStrictEqual({
			hideChrome: {checked: "true", disabled: false},
			statusFooter: null,
		});
	});

	it("applies a stored reduced motion preference on load", async () => {
		stubNotification("granted");
		localStorage.setItem("ccp-motion", "reduced");
		await renderGeneral();

		expect(document.documentElement.getAttribute("data-motion")).toBe("reduced");
	});
});

describe("General settings ▸ Notifications", () => {
	it("shows completions on and permission requests off by default once permission is granted", async () => {
		stubNotification("granted");
		await renderGeneral();

		expect({
			completions: switchState("Response completions"),
			permissionRequests: switchState("Code permission requests"),
		}).toStrictEqual({
			completions: {checked: "true", disabled: false},
			permissionRequests: {checked: "false", disabled: false},
		});
	});

	it("shows both off until the browser grants permission, then asks on toggle", async () => {
		const requestPermission = stubNotification("default");
		await renderGeneral();

		const before = {
			completions: switchState("Response completions"),
			permissionRequests: switchState("Code permission requests"),
		};
		act(() => {
			fireEvent.click(screen.getByRole("switch", {name: "Code permission requests"}));
		});

		expect({before, requested: requestPermission.mock.calls.length}).toStrictEqual({
			before: {
				completions: {checked: "false", disabled: false},
				permissionRequests: {checked: "false", disabled: false},
			},
			requested: 1,
		});
	});

	it("migrates the old desktop notifications key into both new switches", async () => {
		stubNotification("granted");
		localStorage.setItem("ccp-desktop-notifications", "true");
		await renderGeneral();

		expect({
			completions: switchState("Response completions"),
			permissionRequests: switchState("Code permission requests"),
			legacy: localStorage.getItem("ccp-desktop-notifications"),
		}).toStrictEqual({
			completions: {checked: "true", disabled: false},
			permissionRequests: {checked: "true", disabled: false},
			legacy: null,
		});
	});

	it("shows upstream's blocked copy and disables both switches when notifications are denied", async () => {
		stubNotification("denied");
		await renderGeneral();

		expect({
			completions: switchState("Response completions"),
			permissionRequests: switchState("Code permission requests"),
			blocked: screen.getAllByText(
				"Notifications are blocked. Allow them in your browser or system settings, then try again.",
			).length,
		}).toStrictEqual({
			completions: {checked: "false", disabled: true},
			permissionRequests: {checked: "false", disabled: true},
			blocked: 1,
		});
	});

	it("tells the user to open its own tab when notifications can't be turned on here", async () => {
		await renderGeneral();

		expect({
			completions: switchState("Response completions"),
			permissionRequests: switchState("Code permission requests"),
			unavailable: screen.getAllByText(
				"Notifications can\u2019t be turned on here. Open Claude in its own browser tab and try again.",
			).length,
		}).toStrictEqual({
			completions: {checked: "false", disabled: true},
			permissionRequests: {checked: "false", disabled: true},
			unavailable: 1,
		});
	});

	it("shows the blocked copy after the browser refuses a toggle", async () => {
		vi.stubGlobal(
			"Notification",
			Object.assign(function Notification() {}, {
				permission: "default",
				requestPermission: async () => Promise.resolve("denied"),
			}),
		);
		await renderGeneral();
		act(() => {
			fireEvent.click(screen.getByRole("switch", {name: "Response completions"}));
		});
		await act(async () => {});

		expect({
			completions: switchState("Response completions"),
			blocked: screen.getAllByText(
				"Notifications are blocked. Allow them in your browser or system settings, then try again.",
			).length,
		}).toStrictEqual({
			completions: {checked: "false", disabled: true},
			blocked: 1,
		});
	});
});

describe("General settings ▸ Reset", () => {
	const triggerClass =
		"h-8 rounded-r6 px-3 text-body text-primary shadow-[inset_0_0_0_1px_rgb(11_11_11/0.1)] transition-colors hover:bg-fill-ghost-hover focus-visible:shadow-focus focus-visible:outline-hidden dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]";
	const dangerClass =
		"h-8 rounded-r6 bg-[#d03b3b] px-3 text-body font-medium text-white transition-colors hover:bg-[#b93333] focus-visible:shadow-focus focus-visible:outline-hidden";

	function resetRow() {
		const row = document.querySelector('[data-settings-row="reset-settings"]');
		const section = row?.closest("section");
		return {
			title: row?.querySelector(".settings-row-title")?.textContent,
			description: row?.querySelector("[data-settings-desc]")?.textContent,
			sectionHeading: section?.querySelector("h3")?.textContent ?? null,
			lastSection: section === document.querySelector("section:last-of-type"),
			buttons: [...(row?.querySelectorAll("[data-settings-control] button") ?? [])].map((button) => ({
				name: button.textContent,
				className: button.className,
			})),
		};
	}

	it("renders as a settings row in a final untitled section with a quiet Reset all… button", async () => {
		stubNotification("granted");
		await renderGeneral();

		expect(resetRow()).toStrictEqual({
			title: "Reset settings",
			description: "Restore every Claude Code Browser setting to its default.",
			sectionHeading: null,
			lastSection: true,
			buttons: [{name: "Reset all\u2026", className: triggerClass}],
		});
	});

	it("swaps in Cancel and a danger Reset button in the same control slot", async () => {
		stubNotification("granted");
		await renderGeneral();

		fireEvent.click(screen.getByRole("button", {name: "Reset all\u2026"}));

		expect({
			buttons: resetRow().buttons,
			focused: document.activeElement?.textContent,
		}).toStrictEqual({
			buttons: [
				{name: "Cancel", className: triggerClass},
				{name: "Reset", className: dangerClass},
			],
			focused: "Cancel",
		});
	});

	it("cancels on Escape inside the slot without letting the key reach the dialog", async () => {
		stubNotification("granted");
		await renderGeneral();
		const outer = vi.fn<(event: KeyboardEvent) => void>();
		document.addEventListener("keydown", outer);

		fireEvent.click(screen.getByRole("button", {name: "Reset all\u2026"}));
		fireEvent.keyDown(screen.getByRole("button", {name: "Cancel"}), {key: "Escape"});
		document.removeEventListener("keydown", outer);

		expect({
			buttons: resetRow().buttons.map((button) => button.name),
			reachedDocument: outer.mock.calls.length,
			focused: document.activeElement?.textContent,
		}).toStrictEqual({buttons: ["Reset all\u2026"], reachedDocument: 0, focused: "Reset all\u2026"});
	});

	it("resets every setting to its default when Reset is confirmed", async () => {
		stubNotification("granted");
		localStorage.setItem("ccp-chrome-hidden", "true");
		await renderGeneral();

		fireEvent.click(screen.getByRole("button", {name: "Reset all\u2026"}));
		fireEvent.click(screen.getByRole("button", {name: "Reset"}));

		expect({
			hideChrome: switchState("Hide chrome"),
			buttons: resetRow().buttons.map((button) => button.name),
		}).toStrictEqual({
			hideChrome: {checked: "false", disabled: false},
			buttons: ["Reset all\u2026"],
		});
	});
});
