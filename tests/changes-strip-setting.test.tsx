// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {STORAGE_KEYS} from "../src/components/settings-context";
import {SettingsProvider} from "../src/components/settings-provider";
import {SessionsSettings} from "../src/components/settings/settings-sections";
import {installLocalStorage} from "./fake-storage";

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	cleanup();
});

describe("Settings ▸ Sessions ▸ Show working-copy changes strip", () => {
	it("defaults off and persists turning it on", async () => {
		render(
			<SettingsProvider>
				<SessionsSettings />
			</SettingsProvider>,
		);
		await act(async () => {});
		const toggle = screen.getByRole("switch", {name: "Show working-copy changes strip"});
		const before = toggle.getAttribute("aria-checked");
		act(() => {
			fireEvent.click(toggle);
		});
		expect({
			before,
			after: toggle.getAttribute("aria-checked"),
			stored: localStorage.getItem(STORAGE_KEYS.showChangesStrip),
		}).toStrictEqual({before: "false", after: "true", stored: "true"});
	});
});
