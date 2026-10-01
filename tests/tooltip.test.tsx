// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {Tooltip} from "../src/components/ui/tooltip";

const globalsCss = readFileSync(resolve(__dirname, "..", "src", "styles", "globals.css"), "utf8");

/** The value `token` is assigned in the first top-level block opened by `blockSelector`. */
function tokenIn(blockSelector: string, token: string): string | undefined {
	const open = globalsCss.indexOf(`\n${blockSelector} {`);
	if (open === -1) throw new Error(`block not found: ${blockSelector}`);
	const close = globalsCss.indexOf("\n}", open);
	const match = new RegExp(`${token}:\\s*([^;]+);`).exec(globalsCss.slice(open, close));
	return match?.[1]?.trim();
}

function openTooltip(): HTMLElement {
	fireEvent.pointerEnter(screen.getByRole("button"));
	act(() => {
		vi.advanceTimersByTime(300);
	});
	return screen.getByRole("tooltip");
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("tooltip colours", () => {
	it("paints upstream's near-black tooltip with white text, keeping the keycap ink", () => {
		expect({
			bg: tokenIn(":root", "--tooltip-bg"),
			fg: tokenIn(":root", "--tooltip-fg"),
			shortcutInk: tokenIn(":root", "--tooltip-shortcut-ink"),
		}).toStrictEqual({bg: "rgb(11 11 11)", fg: "#fff", shortcutInk: "#898781"});
	});
});

describe("<Tooltip> box", () => {
	it("wraps within 240px, draws upstream's hairline shadow, and keeps the keycaps on one line", () => {
		vi.useFakeTimers();
		vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
		);
		render(
			<Tooltip content="More options for Sync fork with upstream and a long title" shortcut="ctrl+shift+d">
				<button type="button">More</button>
			</Tooltip>,
		);

		const tooltip = openTooltip();

		expect({
			className: tooltip.className,
			shortcut: tooltip.querySelector("[data-cds=Shortcut]")?.className,
		}).toStrictEqual({
			className:
				"pointer-events-none absolute z-50 inline-flex min-h-6 w-max max-w-[240px] items-center gap-2 rounded-r5 bg-[var(--tooltip-bg)] px-2 py-[3px] text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-[0_1px_2px_rgb(11_11_11/0.06)] bottom-full left-1/2 mb-1 -translate-x-1/2",
			shortcut:
				"inline-flex shrink-0 items-baseline gap-[0.3em] text-caption text-[12px] whitespace-nowrap [--shortcut-cap-ink:var(--tooltip-shortcut-ink)]",
		});
	});
});
