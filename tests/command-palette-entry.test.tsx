// @vitest-environment jsdom

import {act, cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {DeferredCommandPalette} from "../src/components/command-palette-entry";

const harness = vi.hoisted(() => {
	let finish!: () => void;
	const ready = new Promise<void>((resolve) => {
		finish = resolve;
	});
	return {ready, finish, fail: true, imports: 0};
});

vi.mock("../src/components/command-palette", async () => {
	harness.imports++;
	await harness.ready;
	return {
		get CommandPalette() {
			if (harness.fail) throw new Error("Example palette chunk unavailable");
			return ({open}: {open: boolean}) => (open ? <div role="dialog" aria-label="Command palette" /> : null);
		},
	};
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function Harness({open}: {open: boolean}) {
	return <DeferredCommandPalette open={open} onOpenChange={() => {}} />;
}

describe("deferred command palette", () => {
	it("loads only on first open, survives a failed load, retries on the next open, and stays mounted once loaded", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const view = render(<Harness open={false} />);
		const closed = {imports: harness.imports, html: view.container.innerHTML};

		await act(async () => {
			view.rerender(<Harness open />);
			harness.finish();
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		const failed = {imports: harness.imports, dialog: screen.queryByRole("dialog")};

		view.rerender(<Harness open={false} />);
		harness.fail = false;
		await act(async () => {
			view.rerender(<Harness open />);
		});
		const opened = await screen.findByRole("dialog", {name: "Command palette"});

		view.rerender(<Harness open={false} />);
		const reclosed = screen.queryByRole("dialog");
		view.rerender(<Harness open />);
		expect({
			closed,
			failed,
			opened: opened.getAttribute("aria-label"),
			reclosed,
			reopened: screen.getByRole("dialog").getAttribute("aria-label"),
			imports: harness.imports,
		}).toStrictEqual({
			closed: {imports: 0, html: ""},
			failed: {imports: 1, dialog: null},
			opened: "Command palette",
			reclosed: null,
			reopened: "Command palette",
			imports: 1,
		});
	});
});
