// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionDock} from "../src/components/session-dock";
import {SettingsProvider} from "../src/components/settings-provider";
import {useSettings} from "../src/components/settings-context";
import {CHAT_COLUMN_CLASS, TRANSCRIPT_WIDTH_PX, transcriptWidthStyle} from "../src/lib/transcript-width";

function setScrollMetrics(
	element: HTMLElement,
	metrics: {scrollTop: number; scrollHeight: number; clientHeight: number},
) {
	for (const [key, value] of Object.entries(metrics)) {
		Object.defineProperty(element, key, {configurable: true, value, writable: true});
	}
}

function DockInScroller({needsInput = false}: {needsInput?: boolean}) {
	const anchorRef = useRef<HTMLDivElement>(null);
	return (
		<div data-testid="scroller" style={{overflowY: "auto"}}>
			<div data-approval-presentation="card" data-testid="question-card" />
			<div ref={anchorRef}>
				<SessionDock anchorRef={anchorRef} needsInput={needsInput}>
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
		const scrollTo = vi.fn<(options: ScrollToOptions) => void>();
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

	it("positions the pill with a 20px gap above the dock, centered within its column", () => {
		render(<DockInScroller />);
		const pill = screen.getByLabelText("Scroll to bottom", {selector: "button"});
		const column = pill.parentElement!;

		expect({
			columnClassName: column.className,
			pillPositioning: ["absolute", "bottom-full", "mb-5", "-top-8", "left-1/2", "-translate-x-1/2", "fixed"].map(
				(className) => [className, pill.classList.contains(className)],
			),
			fades: pill.classList.contains("duration-150"),
			composerInColumn: column.contains(screen.getByLabelText("Fabricated composer")),
		}).toStrictEqual({
			columnClassName: "chat-dock-column relative flex flex-col gap-1.5 comfortable:gap-2",
			pillPositioning: [
				["absolute", true],
				["bottom-full", true],
				["mb-5", true],
				["-top-8", false],
				["left-1/2", true],
				["-translate-x-1/2", true],
				["fixed", false],
			],
			fades: true,
			composerInColumn: true,
		});
	});
});

describe("SessionDock needs-input pill", () => {
	it("turns into upstream's Needs your input pill while a question waits, scrolling to the card", () => {
		render(<DockInScroller needsInput />);
		const scroller = screen.getByTestId("scroller");
		const scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions) => void>();
		Object.defineProperty(screen.getByTestId("question-card"), "scrollIntoView", {
			configurable: true,
			value: scrollIntoView,
		});
		setScrollMetrics(scroller, {scrollTop: 1_000, scrollHeight: 5_000, clientHeight: 1_000});
		act(() => {
			fireEvent.scroll(scroller);
		});
		const pill = screen.getByRole("button", {name: "Needs your input. Scroll to the request"});
		fireEvent.click(pill);

		expect({
			text: pill.textContent,
			dot: pill.querySelector("span.rounded-full")?.className,
			shape: ["h-6", "rounded", "-top-8", "absolute", "left-1/2", "-translate-x-1/2"].every((name) =>
				pill.classList.contains(name),
			),
			scrolled: scrollIntoView.mock.calls,
		}).toStrictEqual({
			text: "Needs your input",
			dot: "size-[6px] shrink-0 rounded-full bg-fill-accent",
			shape: true,
			scrolled: [[{behavior: "smooth", block: "center"}]],
		});
	});
});

describe("SessionDock scroll-to-bottom pill style", () => {
	it("draws upstream's 36px translucent blurred pill with a 20px luminosity-blended arrow", () => {
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
			"bg-[oklab(0.243_0_0/0.8)]",
			"border-[0.5px]",
			"border-white/10",
			"backdrop-blur-[8px]",
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
				["bg-surface-3", false],
				["shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_rgb(0_0_0/0.05)]", false],
				["bg-[oklab(0.243_0_0/0.8)]", true],
				["border-[0.5px]", true],
				["border-white/10", true],
				["backdrop-blur-[8px]", true],
				["text-secondary", true],
				["size-6", false],
				["rounded-full", true],
				["border", false],
				["shadow-panel-sm", false],
				["hover:text-primary", false],
			],
			iconClassName: "lucide lucide-arrow-down size-5 mix-blend-luminosity",
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

	it("allows shell gutter overrides while defaulting to 32px desktop and 16px phone gutters", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const rules = [...styles.matchAll(/\.chat-column \{([^}]+)\}/g)].map(([, declarations]) =>
			declarations!.trim().split(/;\s*/).filter(Boolean),
		);
		expect({className: CHAT_COLUMN_CLASS, rules}).toStrictEqual({
			className: "chat-column",
			rules: [
				[
					"margin-inline: auto",
					"width: 100%",
					"max-width: calc(var(--max-content-width, 768px) + var(--chat-column-extra, 64px))",
					"padding-inline-start: var(--chat-column-start, 16px)",
					"padding-inline-end: var(--chat-column-end, 16px)",
				],
				[
					"padding-inline-start: var(--chat-column-start, 32px)",
					"padding-inline-end: var(--chat-column-end, 32px)",
				],
			],
		});
	});

	it("insets the phone tile's chat column 24px a side inside the 9px card so prose starts at x=33 at 390px, as upstream does", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const shell = styles.match(/\[data-route-tile-shell\] \{([^}]+)\}/)?.[1] ?? "";
		const gutters = Object.fromEntries(
			[...shell.matchAll(/(--chat-column-[a-z]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value]),
		);
		expect(gutters).toStrictEqual({
			"--chat-column-extra": "48px",
			"--chat-column-start": "24px",
			"--chat-column-end": "24px",
		});
	});

	it("insets the phone session tile 9px top, bottom and start and 1px at the end, as upstream's chat card sits at 9,9 380x716 at 390x734", () => {
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const phone =
			styles.match(/@media \(width < 40rem\) \{\s*\[data-route-tile-shell="session"\] \{([^}]+)\}/)?.[1] ?? "";
		expect(
			phone
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line !== "" && !line.startsWith("/*")),
		).toStrictEqual([
			"padding: 9px 1px 9px 9px;",
			"--tile-title-start: max(0px, calc(var(--top-left-clearance-start, 0px) - 9px));",
			"--session-dock-bottom: max(0px, calc(env(safe-area-inset-bottom) - 9px));",
		]);
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
			const value = screen.getByLabelText("width").textContent;
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

it.each([undefined, -1, 0])(
	"hands focused pill activation to the stable scroll host before it becomes inert (tabindex=%s)",
	(tabIndex) => {
		render(<DockInScroller />);
		const scroller = screen.getByTestId("scroller");
		if (tabIndex !== undefined) scroller.tabIndex = tabIndex;
		const focus = vi.spyOn(scroller, "focus");
		const scrollTo = vi.fn<(options: ScrollToOptions) => boolean>(() => document.activeElement === scroller);
		Object.defineProperty(scroller, "scrollTo", {configurable: true, value: scrollTo});
		setScrollMetrics(scroller, {scrollTop: 1000, scrollHeight: 5000, clientHeight: 1000});
		fireEvent.scroll(scroller);
		const pill = screen.getByRole("button", {name: "Scroll to bottom"});
		pill.focus();
		fireEvent.click(pill);
		// The real browser crosses this threshold while its smooth animation is still running.
		setScrollMetrics(scroller, {scrollTop: 3933, scrollHeight: 5000, clientHeight: 1000});
		fireEvent.scroll(scroller);
		expect({
			focusCalls: focus.mock.calls,
			scrollCalls: scrollTo.mock.calls,
			focusedBeforeScroll: scrollTo.mock.results.map((result) => result.value),
			retainedHostFocus: document.activeElement === scroller,
			tabIndex: scroller.getAttribute("tabindex"),
			pill: pillState(pill),
		}).toStrictEqual({
			focusCalls: [[{preventScroll: true}]],
			scrollCalls: [[{top: 5000, behavior: "smooth"}]],
			focusedBeforeScroll: [true],
			retainedHostFocus: true,
			tabIndex: String(tabIndex ?? -1),
			pill: {ariaHidden: "true", inert: true, tabIndex: -1, visible: false},
		});
	},
);

it("preserves another focused control when the pill is activated without taking focus", () => {
	render(<DockInScroller />);
	const scroller = screen.getByTestId("scroller");
	const scrollTo = vi.fn<(options: ScrollToOptions) => void>();
	Object.defineProperty(scroller, "scrollTo", {configurable: true, value: scrollTo});
	setScrollMetrics(scroller, {scrollTop: 1000, scrollHeight: 5000, clientHeight: 1000});
	fireEvent.scroll(scroller);
	const composer = screen.getByLabelText("Fabricated composer");
	composer.focus();
	fireEvent.click(screen.getByRole("button", {name: "Scroll to bottom"}));
	expect({
		composerFocused: document.activeElement === composer,
		tabIndex: scroller.getAttribute("tabindex"),
		calls: scrollTo.mock.calls,
	}).toStrictEqual({
		composerFocused: true,
		tabIndex: null,
		calls: [[{top: 5000, behavior: "smooth"}]],
	});
});
