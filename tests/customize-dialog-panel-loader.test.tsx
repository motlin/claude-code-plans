// @vitest-environment jsdom

import {waitFor} from "@testing-library/react";
import {Suspense} from "react";
import {createRoot} from "react-dom/client";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {CustomizeDialogPanel} from "../src/components/settings/settings-dialog";
import {preloadCustomizeDialogPanel} from "../src/components/settings/customize-dialog-panel-loader";

/**
 * The Customize panel's lazy boundary suspends on its first open (e.g. a `#customize/skills` deep link) while the
 * module downloads, then renders the loaded module synchronously on every later open. Neither pass may trip React's
 * "called use() to suspend … but did not call use() when it finished" warning.
 */

// The download outlasts the first render, as on a real network, so the fallback commits and the retry is a fresh render.
vi.mock("../src/components/customize/customize-dialog-panel", async () => {
	await new Promise((resolve) => {
		setTimeout(resolve, 50);
	});
	return {default: () => <div>Customize panel stub</div>};
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Mounts the panel on a real root outside act(), so React schedules the post-download retry as a browser would. */
async function renderPanel() {
	const actEnvironment: unknown = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		root.render(
			<Suspense fallback={<div>Loading</div>}>
				<CustomizeDialogPanel
					location={{section: "skills", view: "yours", id: null, tab: null, file: null}}
					onNavigate={() => {}}
				/>
			</Suspense>,
		);
		await waitFor(() => {
			expect(container.textContent).toBe("Customize panel stub");
		});
	} finally {
		root.unmount();
		container.remove();
		Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
	}
}

describe("CustomizeDialogPanel", () => {
	it("suspends on the first open and then renders the downloaded panel without a console error", async () => {
		const consoleError = vi.spyOn(console, "error");

		await renderPanel();

		expect(consoleError.mock.calls).toStrictEqual([]);
	});

	it("renders the already-downloaded panel in the same pass without a console error", async () => {
		const consoleError = vi.spyOn(console, "error");
		expect(preloadCustomizeDialogPanel()).toHaveProperty("status", "fulfilled");

		await renderPanel();

		expect(consoleError.mock.calls).toStrictEqual([]);
	});
});
