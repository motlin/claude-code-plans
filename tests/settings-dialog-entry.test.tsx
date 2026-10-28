// @vitest-environment jsdom

import {waitFor} from "@testing-library/react";
import {Suspense} from "react";
import {createRoot} from "react-dom/client";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SettingsDialogLoader} from "../src/components/settings/settings-dialog-entry";
import {loadedSettingsDialog} from "../src/components/settings/settings-dialog-loader";

/**
 * The Settings modal's lazy boundary suspends on its first open while the module downloads, then renders the
 * loaded module synchronously on every later open. Neither pass may trip React's "called use() to suspend … but
 * did not call use() when it finished" warning, which fires when a replayed render skips the use() it suspended on.
 */

// The download outlasts the first render, as on a real network, so the fallback commits and the retry is a fresh render.
vi.mock("../src/components/settings/settings-dialog", async () => {
	await new Promise((resolve) => {
		setTimeout(resolve, 50);
	});
	return {SettingsDialog: () => <div>Settings dialog stub</div>};
});

afterEach(() => {
	vi.restoreAllMocks();
});

/**
 * Mounts the loader on a real root outside act(), so React schedules the post-download retry as a browser would:
 * act() would flush it as an in-place replay, which never reaches the warning.
 */
async function renderLoader() {
	const actEnvironment: unknown = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		root.render(
			<Suspense fallback={<div>Loading</div>}>
				<SettingsDialogLoader />
			</Suspense>,
		);
		await waitFor(() => {
			expect(container.textContent).toBe("Settings dialog stub");
		});
	} finally {
		root.unmount();
		container.remove();
		Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
	}
}

describe("SettingsDialogLoader", () => {
	it("suspends on the first open and then renders the downloaded dialog without a console error", async () => {
		const consoleError = vi.spyOn(console, "error");
		expect(loadedSettingsDialog()).toBeUndefined();

		await renderLoader();

		expect(consoleError.mock.calls).toStrictEqual([]);
	});

	it("renders the already-downloaded dialog in the same pass without a console error", async () => {
		const consoleError = vi.spyOn(console, "error");
		expect(loadedSettingsDialog()).toBeDefined();

		await renderLoader();

		expect(consoleError.mock.calls).toStrictEqual([]);
	});
});
