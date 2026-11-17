// @vitest-environment jsdom

import type {Terminal} from "ghostty-web";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {installTerminalInput} from "../src/components/terminal-input";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

afterEach(() =>
{
	vi.restoreAllMocks();
});

function press(
	userAgent: string,
	{
		type = "normal",
		marked = true,
	}:
	{
		type?: "normal" | "alternate";
		marked?: boolean;
	},
	init: KeyboardEventInit,
)
{
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
	let handler: ((event: KeyboardEvent) => boolean) | undefined;
	const terminal =
	{
		buffer:
		{
			active:
			{
				type,
			},
		},
		hasSelection: () => false,
		getSelection: () => "",
		attachCustomKeyEventHandler(next: (event: KeyboardEvent) => boolean)
		{
			handler = next;
		},
	};
	const scrolls: string[] = [];
	installTerminalInput(
		terminal as unknown as Terminal,
		{
			copy: () =>
			{
			},
			attach: () =>
			{
			},
		},
		() => false,
		(direction) =>
		{
			scrolls.push(direction);
			return marked;
		},
	);
	const claimed = handler?.(new KeyboardEvent("keydown", init));
	return {
		claimed,
		scrolls,
	};
}

describe("terminal command-scroll keys", () =>
{
	it("claims ⌘↑ and ⌘↓ on a Mac once a command is marked", () =>
	{
		expect([
			press(
				MAC,
				{},
				{
					code: "ArrowUp",
					key: "ArrowUp",
					metaKey: true,
				},
			),
			press(
				MAC,
				{},
				{
					code: "ArrowDown",
					key: "ArrowDown",
					metaKey: true,
					repeat: true,
				},
			),
		]).toStrictEqual([
			{
				claimed: true,
				scrolls: ["previous"],
			},
			{
				claimed: true,
				scrolls: ["next"],
			},
		]);
	});

	it("leaves ⌘↑ to the shell when no command is marked", () =>
	{
		expect(
			press(
				MAC,
				{
					marked: false,
				},
				{
					code: "ArrowUp",
					key: "ArrowUp",
					metaKey: true,
				},
			),
		).toStrictEqual(
			{
				claimed: false,
				scrolls: ["previous"],
			},
		);
	});

	it("uses Ctrl off the Mac, and never ⌘ there", () =>
	{
		expect([
			press(
				WINDOWS,
				{},
				{
					code: "ArrowUp",
					key: "ArrowUp",
					ctrlKey: true,
				},
			),
			press(
				WINDOWS,
				{},
				{
					code: "ArrowUp",
					key: "ArrowUp",
					metaKey: true,
				},
			).scrolls,
			press(
				MAC,
				{},
				{
					code: "ArrowUp",
					key: "ArrowUp",
					ctrlKey: true,
				},
			).scrolls,
		]).toStrictEqual([
			{
				claimed: true,
				scrolls: ["previous"],
			},
			[],
			[],
		]);
	});

	it("does not scroll with Shift or Alt held, or on the alternate screen", () =>
	{
		expect([
			press(
				MAC,
				{},
				{
					code: "ArrowUp",
					key: "ArrowUp",
					metaKey: true,
					shiftKey: true,
				},
			).scrolls,
			press(
				MAC,
				{},
				{
					code: "ArrowDown",
					key: "ArrowDown",
					metaKey: true,
					altKey: true,
				},
			).scrolls,
			press(
				MAC,
				{
					type: "alternate",
				},
				{
					code: "ArrowUp",
					key: "ArrowUp",
					metaKey: true,
				},
			).scrolls,
		]).toStrictEqual([[], [], []]);
	});
});
