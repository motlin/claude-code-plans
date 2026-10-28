// @vitest-environment jsdom

import {waitFor} from "@testing-library/react";
import {Suspense} from "react";
import {createRoot} from "react-dom/client";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {PaletteLoader} from "../src/components/command-palette-entry";
import {loadedCommandPalette} from "../src/components/command-palette-loader";

/**
 * The palette's lazy boundary suspends on its first open while the module downloads, then renders the loaded module
 * synchronously on every later open. Neither pass may trip React's "called use() to suspend … but did not call use()
 * when it finished" warning.
 */

// The download outlasts the first render, as on a real network, so the fallback commits and the retry is a fresh render.
vi.mock("../src/components/command-palette", async () => {
	await new Promise((resolve) => {
		setTimeout(resolve, 50);
	});
	return {CommandPalette: () => <div>Command palette stub</div>};
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Mounts the loader on a real root outside act(), so React schedules the post-download retry as a browser would. */
async function renderLoader() {
	const actEnvironment: unknown = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		root.render(
			<Suspense fallback={<div>Loading</div>}>
				<PaletteLoader open onOpenChange={() => {}} />
			</Suspense>,
		);
		await waitFor(() => {
			expect(container.textContent).toBe("Command palette stub");
		});
	} finally {
		root.unmount();
		container.remove();
		Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
	}
}

describe("PaletteLoader", () => {
	it("suspends on the first open and then renders the downloaded palette without a console error", async () => {
		const consoleError = vi.spyOn(console, "error");
		expect(loadedCommandPalette()).toBeUndefined();

		await renderLoader();

		expect(consoleError.mock.calls).toStrictEqual([]);
	});

	it("renders the already-downloaded palette in the same pass without a console error", async () => {
		const consoleError = vi.spyOn(console, "error");
		expect(loadedCommandPalette()).toBeDefined();

		await renderLoader();

		expect(consoleError.mock.calls).toStrictEqual([]);
	});
});
