// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {usePromptJump, type PromptJumpVirtualizer} from "../src/hooks/use-prompt-jump";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

const ENTRY_HEIGHT = 100;

interface MockVirtualizer extends PromptJumpVirtualizer {
	scrollToEntry: ReturnType<typeof vi.fn<(index: number) => void>>;
}

/** Ten 100px entries; prompts sit at entries 1, 4 and 7. */
function mockVirtualizer(viewportOffset: number): MockVirtualizer {
	return {
		promptIndices: [1, 4, 7],
		entryOffset: (index) => index * ENTRY_HEIGHT,
		viewportOffset: () => viewportOffset,
		scrollToEntry: vi.fn<(index: number) => void>(),
	};
}

function Harness({virtualizer}: {virtualizer: PromptJumpVirtualizer}) {
	usePromptJump(virtualizer);
	return null;
}

function press(key: "ArrowUp" | "ArrowDown", mac: boolean): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {
		key,
		code: key,
		metaKey: mac,
		altKey: true,
		bubbles: true,
		cancelable: true,
	});
	act(() => {
		document.body.dispatchEvent(event);
	});
	return event;
}

function jumps(viewportOffset: number, key: "ArrowUp" | "ArrowDown", mac = true) {
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(mac ? MAC_UA : LINUX_UA);
	const virtualizer = mockVirtualizer(viewportOffset);
	render(<Harness virtualizer={virtualizer} />);
	const event = press(key, mac);
	return {scrolledTo: virtualizer.scrollToEntry.mock.calls, prevented: event.defaultPrevented};
}

describe("prompt jump", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("⌥⌘↑ jumps to the prompt above the viewport top", () => {
		expect(jumps(550, "ArrowUp")).toStrictEqual({scrolledTo: [[4]], prevented: true});
	});

	it("⌥⌘↓ jumps to the prompt below the viewport top", () => {
		expect(jumps(550, "ArrowDown")).toStrictEqual({scrolledTo: [[7]], prevented: true});
	});

	it("⌥⌘↑ skips the prompt already aligned with the viewport top", () => {
		expect(jumps(400, "ArrowUp")).toStrictEqual({scrolledTo: [[1]], prevented: true});
	});

	it("⌥⌘↓ skips the prompt already aligned with the viewport top", () => {
		expect(jumps(400, "ArrowDown")).toStrictEqual({scrolledTo: [[7]], prevented: true});
	});

	it("is a no-op above the first prompt", () => {
		expect(jumps(100, "ArrowUp")).toStrictEqual({scrolledTo: [], prevented: false});
	});

	it("is a no-op below the last prompt", () => {
		expect(jumps(700, "ArrowDown")).toStrictEqual({scrolledTo: [], prevented: false});
	});

	it("uses Alt+↑ / Alt+↓ off mac", () => {
		expect(jumps(550, "ArrowUp", false)).toStrictEqual({scrolledTo: [[4]], prevented: true});
	});

	it("does nothing without prompts", () => {
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
		const virtualizer = {...mockVirtualizer(0), promptIndices: []};
		render(<Harness virtualizer={virtualizer} />);
		press("ArrowDown", true);
		expect(virtualizer.scrollToEntry.mock.calls).toStrictEqual([]);
	});
});
