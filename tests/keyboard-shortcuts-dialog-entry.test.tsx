// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {DeferredKeyboardShortcutsDialog} from "../src/components/keyboard-shortcuts-dialog-entry";
import {setKeyboardShortcutsOpen} from "../src/components/keyboard-shortcuts-open";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

afterEach(() => {
	act(() => {
		setKeyboardShortcutsOpen(false);
	});
	cleanup();
	vi.restoreAllMocks();
});

describe("deferred Keyboard shortcuts dialog", () => {
	it("renders nothing until ⌘/ first opens it, then downloads and shows the dialog", async () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		let view!: ReturnType<typeof render>;
		await act(async () => {
			view = render(
				<>
					<textarea aria-label="Composer" />
					<DeferredKeyboardShortcutsDialog />
				</>,
			);
			await Promise.resolve();
		});
		const closed = {html: view.container.innerHTML, dialog: screen.queryByRole("dialog")};
		const composer = screen.getByRole("textbox", {name: "Composer"});
		composer.focus();

		await act(async () => {
			fireEvent.keyDown(composer, {key: "/", code: "Slash", metaKey: true});
			await Promise.resolve();
		});
		const dialog = await screen.findByRole("dialog", {name: "Keyboard shortcuts"}, {timeout: 2000});

		expect({closed, opened: dialog.getAttribute("data-perf-overlay")}).toStrictEqual({
			closed: {html: '<textarea aria-label="Composer"></textarea>', dialog: null},
			opened: "keyboard_shortcuts_dialog",
		});
	});
});
