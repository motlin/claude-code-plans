// @vitest-environment jsdom

import {act, cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ConfirmDialog} from "../src/components/confirm-dialog";
import {KeyboardShortcutsDialog} from "../src/components/keyboard-shortcuts-dialog";
import {setKeyboardShortcutsOpen} from "../src/components/keyboard-shortcuts-open";
import {NewGroupDialog} from "../src/components/new-group-dialog";
import {DensityScope} from "../src/components/ui/density";

afterEach(() => {
	act(() => {
		setKeyboardShortcutsOpen(false);
	});
	cleanup();
});

function scopeOf(popup: HTMLElement) {
	return popup.parentElement?.closest("[data-density]")?.getAttribute("data-density") ?? null;
}

/* Upstream wraps confirm, rename and the shortcuts dialog in `si density:"comfortable"`, so they stay comfortable when opened from the compact main column. */
describe("dialogs opened from the compact main column", () => {
	it("forces comfortable on the confirm dialog", async () => {
		render(
			<DensityScope density="compact">
				<ConfirmDialog
					open
					onOpenChange={() => {}}
					title="Delete session?"
					confirmLabel="Delete"
					onConfirm={() => {}}
				/>
			</DensityScope>,
		);

		expect(scopeOf(await screen.findByRole("alertdialog"))).toBe("comfortable");
	});

	it("forces comfortable on the new-group dialog", async () => {
		render(
			<DensityScope density="compact">
				<NewGroupDialog open onOpenChange={() => {}} switchesGroupBy={false} onCreate={() => {}} />
			</DensityScope>,
		);

		expect(scopeOf(await screen.findByRole("dialog", {name: "New group"}))).toBe("comfortable");
	});

	it("forces comfortable on the keyboard shortcuts dialog", async () => {
		render(
			<DensityScope density="compact">
				<KeyboardShortcutsDialog />
			</DensityScope>,
		);
		act(() => {
			setKeyboardShortcutsOpen(true);
		});

		expect(scopeOf(await screen.findByRole("dialog", {name: "Keyboard shortcuts"}))).toBe("comfortable");
	});
});
