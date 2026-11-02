// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {Menu, MenuContent, MenuItem, MenuTrigger} from "../src/components/ui/menu";
import {preloadMenuSheet} from "../src/components/ui/menu-sheet-loader";
import {PopoverContent, PopoverRoot, PopoverTrigger} from "../src/components/ui/popover";
import {preloadPopoverSheet} from "../src/components/ui/popover-sheet-loader";

const ANDROID_UA =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface StubWatcher {
	onclose: (() => void) | null;
	destroyed: boolean;
}

const watchers: StubWatcher[] = [];

beforeAll(async () => {
	await Promise.all([preloadPopoverSheet(), preloadMenuSheet()]);
});

beforeEach(() => {
	watchers.length = 0;
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches: query === "(pointer: coarse)" || query === "(pointer: coarse) and (max-width: 639.98px)",
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
	vi.stubGlobal(
		"CloseWatcher",
		class implements StubWatcher {
			onclose: (() => void) | null = null;
			destroyed = false;
			constructor() {
				watchers.push(this);
			}
			destroy() {
				this.destroyed = true;
			}
		},
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function stubUserAgent(userAgent: string) {
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
}

function openPopoverSheet() {
	render(
		<PopoverRoot>
			<PopoverTrigger>Usage</PopoverTrigger>
			<PopoverContent>
				<p>Body</p>
			</PopoverContent>
		</PopoverRoot>,
	);
	fireEvent.click(screen.getByRole("button", {name: "Usage"}));
}

describe("Android back closes a bottom sheet, as upstream's CloseWatcher (Sp)", () => {
	it("closes the popover sheet when its CloseWatcher fires", async () => {
		stubUserAgent(ANDROID_UA);
		openPopoverSheet();
		const opened = watchers.length;
		watchers[0]?.onclose?.();
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect({opened, destroyed: watchers.map((watcher) => watcher.destroyed)}).toStrictEqual({
			opened: 1,
			destroyed: [true],
		});
	});

	it("closes the menu sheet when its CloseWatcher fires", async () => {
		stubUserAgent(ANDROID_UA);
		render(
			<Menu>
				<MenuTrigger aria-label="More options">...</MenuTrigger>
				<MenuContent>
					<MenuItem>Copy link</MenuItem>
				</MenuContent>
			</Menu>,
		);
		fireEvent.click(screen.getByRole("button", {name: "More options"}));
		await screen.findByRole("menu");
		const opened = watchers.length;
		watchers[0]?.onclose?.();
		await waitFor(() => {
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(opened).toBe(1);
	});

	it("swallows the pointerup that follows the back gesture once", () => {
		stubUserAgent(ANDROID_UA);
		openPopoverSheet();
		watchers[0]?.onclose?.();
		const first = fireEvent.pointerUp(document.body);
		const second = fireEvent.pointerUp(document.body);
		expect({first, second}).toStrictEqual({first: false, second: true});
	});

	it("creates no CloseWatcher off Android", () => {
		stubUserAgent(MAC_UA);
		openPopoverSheet();
		expect({
			sheet: screen.getByRole("dialog").getAttribute("data-presentation"),
			watchers: watchers.length,
		}).toStrictEqual({
			sheet: "sheet",
			watchers: 0,
		});
	});
});
