// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionDock} from "../src/components/session-dock";
import {SettingsProvider, useSettings} from "../src/components/settings-provider";
import {CHAT_COLUMN_CLASS, TRANSCRIPT_WIDTH_PX, transcriptWidthStyle} from "../src/lib/transcript-width";

function setScrollMetrics(
	element: HTMLElement,
	metrics: {scrollTop: number; scrollHeight: number; clientHeight: number},
) {
	for (const [key, value] of Object.entries(metrics)) {
		Object.defineProperty(element, key, {configurable: true, value, writable: true});
	}
}

function DockInScroller() {
	const anchorRef = useRef<HTMLDivElement>(null);
	return (
		<div data-testid="scroller" style={{overflowY: "auto"}}>
			<div ref={anchorRef}>
				<SessionDock anchorRef={anchorRef}>
					<textarea aria-label="Fabricated composer" />
				</SessionDock>
			</div>
		</div>
	);
}

function pillState(pill: HTMLElement) {
	return {
		ariaHidden: pill.getAttribute("aria-hidden"),
		inert: pill.hasAttribute("inert"),
		tabIndex: pill.tabIndex,
		visible: pill.classList.contains("opacity-100"),
	};
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("SessionDock scroll-to-bottom pill", () => {
	it("shows only when away from the bottom and scrolls the transcript to the end on click", () => {
		render(<DockInScroller />);
		const scroller = screen.getByTestId("scroller");
		const scrollTo = vi.fn();
		Object.defineProperty(scroller, "scrollTo", {configurable: true, value: scrollTo});
		const pill = screen.getByLabelText("Scroll to bottom", {selector: "button"});

		setScrollMetrics(scroller, {scrollTop: 4_000, scrollHeight: 5_000, clientHeight: 1_000});
		act(() => {
			fireEvent.scroll(scroller);
		});
		const atBottom = pillState(pill);

		setScrollMetrics(scroller, {scrollTop: 1_000, scrollHeight: 5_000, clientHeight: 1_000});
		act(() => {
			fireEvent.scroll(scroller);
		});
		const awayFromBottom = pillState(pill);

		fireEvent.click(pill);

		expect({atBottom, awayFromBottom, scrollToCalls: scrollTo.mock.calls}).toStrictEqual({
			atBottom: {ariaHidden: "true", inert: true, tabIndex: -1, visible: false},
			awayFromBottom: {ariaHidden: null, inert: false, tabIndex: 0, visible: true},
			scrollToCalls: [[{top: 5_000, behavior: "smooth"}]],
		});
	});

	it("positions the pill centered 32px above the dock, not fixed to the viewport", () => {
		render(<DockInScroller />);
		const pill = screen.getByLabelText("Scroll to bottom", {selector: "button"});
		const column = pill.parentElement!;

		expect({
			columnClassName: column.className,
			pillPositioning: ["absolute", "-top-8", "left-1/2", "-translate-x-1/2", "fixed"].map((className) => [
				className,
				pill.classList.contains(className),
			]),
			fades: pill.classList.contains("duration-150"),
			composerInColumn: column.contains(screen.getByLabelText("Fabricated composer")),
		}).toStrictEqual({
			columnClassName: `${CHAT_COLUMN_CLASS} relative flex flex-col gap-1.5`,
			pillPositioning: [
				["absolute", true],
				["-top-8", true],
				["left-1/2", true],
				["-translate-x-1/2", true],
				["fixed", false],
			],
			fades: true,
			composerInColumn: true,
		});
	});
});

describe("SessionDock scroll-to-bottom pill style", () => {
	it("draws a 36px circular pill with a 20px downward arrow", () => {
		render(<DockInScroller />);
		const pill = screen.getByLabelText("Scroll to bottom", {selector: "button"});
		const shape = [
			"size-9",
			"p-1",
			"h-6",
			"w-5",
			"px-1",
			"rounded-r5",
			"bg-surface-3",
			"shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_rgb(0_0_0/0.05)]",
			"text-secondary",
			"size-6",
			"rounded-full",
			"border",
			"shadow-panel-sm",
			"hover:text-primary",
		];
		const icon = pill.querySelector("svg")!;

		expect({
			shape: shape.map((className) => [className, pill.classList.contains(className)]),
			iconClassName: icon.getAttribute("class"),
			title: pill.getAttribute("title"),
		}).toStrictEqual({
			shape: [
				["size-9", true],
				["p-1", true],
				["h-6", false],
				["w-5", false],
				["px-1", false],
				["rounded-r5", false],
				["bg-surface-3", true],
				["shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_rgb(0_0_0/0.05)]", true],
				["text-secondary", true],
				["size-6", false],
				["rounded-full", true],
				["border", false],
				["shadow-panel-sm", false],
				["hover:text-primary", false],
			],
			iconClassName: "lucide lucide-arrow-down size-5",
			title: null,
		});
	});
});

describe("transcript width setting", () => {
	it("maps narrow, medium and wide to the --max-content-width CSS variable", () => {
		expect({
			px: TRANSCRIPT_WIDTH_PX,
			narrow: transcriptWidthStyle("narrow"),
			medium: transcriptWidthStyle("medium"),
			wide: transcriptWidthStyle("wide"),
		}).toStrictEqual({
			px: {narrow: 768, medium: 960, wide: 1280},
			narrow: {"--max-content-width": "768px"},
			medium: {"--max-content-width": "960px"},
			wide: {"--max-content-width": "1280px"},
		});
	});

	it("builds the shared chat column measure from the CSS variable plus upstream's 32px gutters (16px on phones)", () => {
		expect(CHAT_COLUMN_CLASS).toBe("mx-auto w-full max-w-[calc(var(--max-content-width,768px)+64px)] px-4 sm:px-8");
	});

	it("defaults to narrow, reads a stored width, and ignores an unknown stored value", () => {
		function Readout() {
			const {settings, loaded} = useSettings();
			return <output aria-label="width">{loaded ? settings.transcriptWidth : "loading"}</output>;
		}
		const storage = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key),
		});

		const readWidth = (): string => {
			const view = render(
				<SettingsProvider>
					<Readout />
				</SettingsProvider>,
			);
			const value = screen.getByLabelText("width").textContent ?? "";
			view.unmount();
			return value;
		};

		const unset = readWidth();
		storage.set("ccp-transcript-width", "wide");
		const stored = readWidth();
		storage.set("ccp-transcript-width", "enormous");
		const unknown = readWidth();

		expect({unset, stored, unknown}).toStrictEqual({
			unset: "narrow",
			stored: "wide",
			unknown: "narrow",
		});
	});
});
