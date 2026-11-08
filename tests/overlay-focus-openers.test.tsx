// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {Menu, MenuContent, MenuItem, MenuTrigger} from "../src/components/ui/menu";
import {PopoverContent, PopoverRoot, PopoverTrigger} from "../src/components/ui/popover";
import {walkOpenerChain} from "../src/lib/overlay-focus";
import {CompactScope} from "./fizzy-lake-off";

afterEach(() => {
	cleanup();
});

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

describe("Menu and Popover popups register their opener (upstream iR's Sh)", () => {
	it("walks from a menu item to the menu trigger", async () => {
		render(
			<CompactScope>
				<Menu>
					<MenuTrigger aria-label="More options">...</MenuTrigger>
					<MenuContent>
						<MenuItem>Delete</MenuItem>
					</MenuContent>
				</Menu>
			</CompactScope>,
		);
		const trigger = screen.getByRole("button", {name: "More options"});
		fireEvent.click(trigger);
		await flush();
		expect(walkOpenerChain(screen.getByRole("menuitem", {name: "Delete"}))).toStrictEqual({
			targets: [trigger],
			dialog: null,
		});
	});

	it("walks from inside a popover to its trigger", async () => {
		render(
			<PopoverRoot>
				<PopoverTrigger>Usage</PopoverTrigger>
				<PopoverContent>
					<button type="button">Inside</button>
				</PopoverContent>
			</PopoverRoot>,
		);
		const trigger = screen.getByRole("button", {name: "Usage"});
		fireEvent.click(trigger);
		await flush();
		expect(walkOpenerChain(screen.getByRole("button", {name: "Inside"}))).toStrictEqual({
			targets: [trigger],
			dialog: null,
		});
	});
});
