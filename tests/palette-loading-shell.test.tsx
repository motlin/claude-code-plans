// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {DeferredCommandPalette} from "../src/components/command-palette-entry";
import type {PaletteMode} from "../src/hooks/use-command-palette";
import {appendPaletteKey, readPaletteKeys} from "../src/lib/palette-keystroke-buffer";
import {paletteLoadingShown} from "../src/lib/palette-loading";

// The palette module stays in flight until the last test, so every open before it draws the loading shell.
const harness = vi.hoisted(() =>
{
	let finish!: () => void;
	const ready = new Promise<void>((resolve) =>
	{
		finish = resolve;
	});
	return {
		ready,
		finish,
	};
});

vi.mock("../src/components/command-palette", async () =>
{
	await harness.ready;
	return {
		CommandPalette: ({open}: {open: boolean}) => (open ? <div role="dialog" aria-label="Command palette" /> : null),
	};
});

afterEach(() =>
{
	cleanup();
});

function Harness({mode}: {mode: PaletteMode})
{
	const [open, setOpen] = useState(true);
	return <DeferredCommandPalette open={open} mode={mode} onOpenChange={setOpen} />;
}

async function openShell(mode: PaletteMode)
{
	await act(async () =>
	{
		render(<Harness mode={mode} />);
		await Promise.resolve();
	});
	const popup = await screen.findByRole(
		"dialog",
		{
			name: "Search",
		},
	);
	await waitFor(() =>
	{
		expect(document.activeElement).toBe(popup);
	});
	return popup;
}

function snapshot(popup: HTMLElement)
{
	return {
		shell: popup.hasAttribute("data-palette-loading-shell") && popup.hasAttribute("data-command-palette"),
		focused: document.activeElement === popup,
		settled: popup.style.getPropertyValue("--cp-settled-h"),
		field: document.querySelector(String.raw`.h-\[7\.375rem\]`) !== null,
		bars: document.querySelectorAll("[data-palette-loading] [data-cds=Skeleton]").length,
		shown: paletteLoadingShown(),
	};
}

function key(target: Element, init: KeyboardEventInit): boolean
{
	// fireEvent returns false when a listener called preventDefault().
	return !fireEvent.keyDown(target, init);
}

describe("palette loading shell (upstream eager shell + v8)", () =>
{
	it("draws the dialog shell and the Compose skeleton, focused, while the palette module loads", async () =>
	{
		const popup = await openShell("compose");
		expect(snapshot(popup)).toStrictEqual(
			{
				shell: true,
				focused: true,
				settled: "583.9px",
				field: true,
				bars: 3,
				shown: true,
			},
		);
	});

	it("draws the Search skeleton and buffers printable keys and Backspace typed during the load", async () =>
	{
		const popup = await openShell("search");
		const prevented = [
			key(
				popup,
				{
					key: "a",
				},
			),
			key(
				popup,
				{
					key: "b",
				},
			),
			key(
				popup,
				{
					key: "Backspace",
				},
			),
			key(
				popup,
				{
					key: "c",
				},
			),
			key(
				popup,
				{
					key: "k",
					metaKey: true,
				},
			),
			key(
				popup,
				{
					key: "x",
					isComposing: true,
				},
			),
			key(
				popup,
				{
					key: "ArrowDown",
				},
			),
		];
		expect(
			{
				...snapshot(popup),
				prevented,
				buffered: readPaletteKeys(),
			},
		).toStrictEqual(
			{
				shell: true,
				focused: true,
				settled: "583.9px",
				field: false,
				bars: 27,
				shown: true,
				prevented: [true, true, true, true, false, false, false],
				buffered: "ac",
			},
		);
	});

	it("clears the buffer when the shell closes during the load", async () =>
	{
		const popup = await openShell("search");
		key(
			popup,
			{
				key: "q",
			},
		);
		const typed = readPaletteKeys();
		fireEvent.keyDown(
			popup,
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(
			{
				typed,
				after: readPaletteKeys(),
				shown: paletteLoadingShown(),
			},
		).toStrictEqual(
			{
				typed: "q",
				after: "",
				shown: false,
			},
		);
	});

	it("starts each open with an empty buffer and hands off to the palette once its module arrives", async () =>
	{
		appendPaletteKey("z");
		await openShell("search");
		const atOpen = readPaletteKeys();
		await act(async () =>
		{
			harness.finish();
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 50);
			});
		});
		const palette = await screen.findByRole(
			"dialog",
			{
				name: "Command palette",
			},
		);
		expect(
			{
				atOpen,
				palette: palette.getAttribute("aria-label"),
				shell: document.querySelector("[data-palette-loading-shell]"),
				shown: paletteLoadingShown(),
			},
		).toStrictEqual(
			{
				atOpen: "",
				palette: "Command palette",
				shell: null,
				shown: true,
			},
		);
	});
});
