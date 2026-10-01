// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {Shortcut} from "../src/components/ui/shortcut";
import {Tooltip} from "../src/components/ui/tooltip";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const KEYCAP =
	"inline-flex shrink-0 items-center justify-center h-[calc(1em+6px)] rounded-r3 [color:var(--shortcut-cap-ink)] bg-transparent border border-[color:var(--shortcut-cap-line)] [font-family:inherit] [font-variation-settings:inherit] [line-height:1]";
const SQUARE = `${KEYCAP} w-[calc(1em+6px)] px-0`;
const WIDE = `${KEYCAP} min-w-[calc(1em+6px)] px-[3px]`;
const KEYCAP_WRAPPER = "inline-flex shrink-0 items-center gap-[2px] text-caption";
const TEXT_WRAPPER = "inline-flex shrink-0 items-baseline gap-[0.3em] text-caption";

function stubUserAgent(ua: string): void {
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("<Shortcut variant=keycap>", () => {
	it("renders one square keycap per key on mac with aria-hidden glyphs and sr-only spoken labels", () => {
		stubUserAgent(MAC_UA);
		const {container} = render(<Shortcut keys="shift+cmd+k" />);

		expect(container.innerHTML).toBe(
			`<span data-cds="Shortcut" data-variant="keycap" class="${KEYCAP_WRAPPER}">` +
				`<kbd class="${SQUARE}"><span aria-hidden="true">⇧</span><span class="sr-only select-none">Shift</span></kbd>` +
				`<kbd class="${SQUARE}"><span aria-hidden="true">⌘</span><span class="sr-only select-none">Command</span></kbd>` +
				`<kbd class="${SQUARE}">K</kbd>` +
				`</span>`,
		);
	});

	it("uses a min-width padded keycap for multi-character labels", () => {
		stubUserAgent(MAC_UA);
		const {container} = render(<Shortcut keys="esc" />);

		expect(container.innerHTML).toBe(
			`<span data-cds="Shortcut" data-variant="keycap" class="${KEYCAP_WRAPPER}">` +
				`<kbd class="${WIDE}">Esc</kbd>` +
				`</span>`,
		);
	});

	it("renders Ctrl words instead of glyphs on non-mac platforms", () => {
		stubUserAgent(WINDOWS_UA);
		const {container} = render(<Shortcut keys="shift+cmd+k" />);

		expect(container.innerHTML).toBe(
			`<span data-cds="Shortcut" data-variant="keycap" class="${KEYCAP_WRAPPER}">` +
				`<kbd class="${WIDE}">Ctrl</kbd>` +
				`<kbd class="${WIDE}">Shift</kbd>` +
				`<kbd class="${SQUARE}">K</kbd>` +
				`</span>`,
		);
	});
});

describe("<Shortcut variant=text>", () => {
	it("concatenates mac glyphs in one borderless kbd", () => {
		stubUserAgent(MAC_UA);
		const {container} = render(<Shortcut keys="shift+cmd+o" variant="text" />);

		expect(container.innerHTML).toBe(
			`<span data-cds="Shortcut" data-variant="text" class="${TEXT_WRAPPER}">` +
				`<kbd class="[font-family:inherit] [color:var(--shortcut-cap-ink)]">` +
				`<span aria-hidden="true">⇧</span><span class="sr-only select-none">Shift</span>` +
				`<span aria-hidden="true">⌘</span><span class="sr-only select-none">Command</span>` +
				`O</kbd>` +
				`</span>`,
		);
	});

	it("joins non-mac labels with +", () => {
		stubUserAgent(WINDOWS_UA);
		const {container} = render(<Shortcut keys="shift+cmd+o" variant="text" />);

		expect(container.innerHTML).toBe(
			`<span data-cds="Shortcut" data-variant="text" class="${TEXT_WRAPPER}">` +
				`<kbd class="[font-family:inherit] [color:var(--shortcut-cap-ink)]">Ctrl+Shift+O</kbd>` +
				`</span>`,
		);
	});
});

describe("<Tooltip>", () => {
	it("shows the dark tooltip with a text shortcut only after the 300ms delay", () => {
		vi.useFakeTimers();
		stubUserAgent(MAC_UA);
		render(
			<Tooltip content="Expand chat" shortcut="shift+cmd+\">
				<button type="button">Expand</button>
			</Tooltip>,
		);

		fireEvent.pointerEnter(screen.getByRole("button", {name: "Expand"}));
		act(() => {
			vi.advanceTimersByTime(299);
		});
		const beforeDelay = screen.queryByRole("tooltip");
		act(() => {
			vi.advanceTimersByTime(1);
		});
		const tooltip = screen.getByRole("tooltip");

		expect({
			beforeDelay,
			className: tooltip.className,
			text: tooltip.textContent,
			shortcut: tooltip.querySelector("[data-cds=Shortcut]")?.getAttribute("data-variant"),
			describedBy: screen.getByRole("button", {name: "Expand"}).getAttribute("aria-describedby") === tooltip.id,
		}).toStrictEqual({
			beforeDelay: null,
			className:
				"pointer-events-none absolute z-50 inline-flex min-h-6 w-max max-w-[240px] items-center gap-2 rounded-r5 bg-[var(--tooltip-bg)] px-2 py-[3px] text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-[0_1px_2px_rgb(11_11_11/0.06)] bottom-full left-1/2 mb-1 -translate-x-1/2",
			text: "Expand chat⇧Shift⌘Command\\",
			shortcut: "text",
			describedBy: true,
		});

		fireEvent.pointerLeave(screen.getByRole("button", {name: "Expand"}));
		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	it("stacks a muted description line under the label and shortcut", () => {
		vi.useFakeTimers();
		stubUserAgent(MAC_UA);
		render(
			<Tooltip content="Hide sidebar" shortcut="cmd+b" description="Drag to resize" side="right">
				<button type="button">Edge</button>
			</Tooltip>,
		);

		fireEvent.pointerEnter(screen.getByRole("button", {name: "Edge"}));
		act(() => {
			vi.advanceTimersByTime(300);
		});
		const tooltip = screen.getByRole("tooltip");

		expect({
			className: tooltip.className,
			lines: [...tooltip.children].map((line) => ({className: line.className, text: line.textContent})),
		}).toStrictEqual({
			className:
				"pointer-events-none absolute z-50 flex w-max max-w-[170px] flex-col items-start gap-0.5 whitespace-normal rounded-r5 bg-[var(--tooltip-bg)] px-2 py-1.5 text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-[0_1px_2px_rgb(11_11_11/0.06)] left-full top-1/2 ml-1 -translate-y-1/2",
			lines: [
				{className: "inline-flex items-center gap-2", text: "Hide sidebar⌘CommandB"},
				{className: "text-[11px]/[14px] text-[var(--tooltip-description-ink)]", text: "Drag to resize"},
			],
		});
	});

	it("opens on keyboard focus and closes on blur", () => {
		vi.useFakeTimers();
		render(
			<Tooltip content="Show header and footer">
				<button type="button">Show chrome</button>
			</Tooltip>,
		);

		fireEvent.focus(screen.getByRole("button", {name: "Show chrome"}));
		act(() => {
			vi.advanceTimersByTime(300);
		});
		const opened = screen.getByRole("tooltip").textContent;
		fireEvent.blur(screen.getByRole("button", {name: "Show chrome"}));

		expect({opened, afterBlur: screen.queryByRole("tooltip")}).toStrictEqual({
			opened: "Show header and footer",
			afterBlur: null,
		});
	});
});
