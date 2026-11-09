// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useContext} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ColdResumeNotice} from "../src/components/cold-resume-notice";
import {resetColdResumeStore} from "../src/lib/cold-resume-notice";
import {EntriesContext} from "../src/components/composer-notice-context";
import {ComposerNoticeProvider, ComposerNoticeRegion} from "../src/components/composer-notice-region";

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const LAST = NOW - 26 * 3600e3;

let hasFocus = true;
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
	vi.useFakeTimers({toFake: ["Date", "setInterval", "clearInterval"]});
	vi.setSystemTime(NOW);
	hasFocus = true;
	visibility = "visible";
	vi.spyOn(document, "hasFocus").mockImplementation(() => hasFocus);
	vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
	resetColdResumeStore();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function EntryIds() {
	const entries = useContext(EntriesContext);
	return (
		<output data-testid="entries">{[...entries].map(([slot, entry]) => `${slot}=${entry.id}`).join(",")}</output>
	);
}

interface Props {
	running?: boolean;
	heldInput?: boolean;
	fiveHourPct?: number | null;
	onStay?: () => void;
	onCompact?: (() => void) | undefined;
	onNewSession?: (() => void) | undefined;
}

function ui(props: Props = {}) {
	const {running = false, heldInput = false, fiveHourPct = 20, onStay = vi.fn<() => void>()} = props;
	const onCompact = "onCompact" in props ? props.onCompact : vi.fn<() => void>();
	const onNewSession = "onNewSession" in props ? props.onNewSession : vi.fn<() => void>();
	return (
		<ComposerNoticeProvider>
			<ComposerNoticeRegion />
			<EntryIds />
			<div data-session-footer="">
				<input data-testid="composer" />
			</div>
			<ColdResumeNotice
				sessionId="s1"
				lastRecordMs={LAST}
				running={running}
				heldInput={heldInput}
				contextTokens={412_000}
				fiveHourPct={fiveHourPct}
				anyWindowSpent={false}
				onStay={onStay}
				onCompact={onCompact}
				onNewSession={onNewSession}
			/>
		</ComposerNoticeProvider>
	);
}

const entries = () => screen.getByTestId("entries").textContent;
const banners = () =>
	document.querySelectorAll('[data-cds-dock-card]:not([data-cds-dock-leaving]) [data-cds="Banner"]');

describe("ColdResumeNotice", () => {
	it("registers a card in slot eagerCookie with heading, detail and three actions", () => {
		render(ui());
		expect(entries()).toBe(`eagerCookie=s1:${LAST}`);
		expect(banners()).toHaveLength(1);
		const banner = banners()[0];
		const atomic = banner.querySelector('span[aria-atomic="true"]');
		expect(atomic?.className).toBe("flex flex-col");
		expect(atomic?.textContent).toBe(
			"This session has been idle Idle 26 hours. Resuming will use about 16% of your 5-hour limit.",
		);
		expect(atomic?.querySelector("span.text-muted-as-secondary")?.textContent).toBe(
			"Idle 26 hours. Resuming will use about 16% of your 5-hour limit.",
		);
		const group = banner.querySelector("div.flex.min-w-0.flex-wrap.items-center.gap-xs");
		expect([...(group?.querySelectorAll("button") ?? [])].map((button) => button.textContent)).toStrictEqual([
			"Resume here",
			"New session",
			"Compact",
		]);
		const newSession = screen.getByRole("button", {name: "New session"});
		const tipId = newSession.getAttribute("aria-describedby");
		expect(document.getElementById(tipId!)?.hidden).toBe(true);
		expect(document.getElementById(tipId!)?.textContent).toBe("Mentions this session");
		const compact = screen.getByRole("button", {name: "Compact"});
		expect(document.getElementById(compact.getAttribute("aria-describedby")!)?.textContent).toBe(
			"Summarize the conversation so far to make resuming cheaper",
		);
		expect(banner.querySelector('button[aria-label="Dismiss"]')).not.toBeNull();
	});

	it("Resume calls onStay once, leaves and stays answered across re-renders", () => {
		const onStay = vi.fn<() => void>();
		const {rerender} = render(ui({onStay}));
		fireEvent.click(screen.getByRole("button", {name: "Resume here"}));
		expect(onStay).toHaveBeenCalledTimes(1);
		expect(entries()).toBe("");
		rerender(ui({onStay}));
		expect(entries()).toBe("");
	});

	it("Dismiss answers without calling onStay", () => {
		const onStay = vi.fn<() => void>();
		render(ui({onStay}));
		fireEvent.click(screen.getByRole("button", {name: "Dismiss"}));
		expect(onStay).not.toHaveBeenCalled();
		expect(entries()).toBe("");
	});

	it("Compact calls onCompact once and is a no-op once a turn runs", () => {
		const onCompact = vi.fn<() => void>();
		const {rerender} = render(ui({onCompact}));
		fireEvent.click(screen.getByRole("button", {name: "Compact"}));
		expect(onCompact).toHaveBeenCalledTimes(1);
		expect(entries()).toBe("");

		resetColdResumeStore();
		const second = vi.fn<() => void>();
		rerender(ui({onCompact: second, running: false}));
		const button = screen.getAllByRole("button", {name: "Compact"}).at(-1)!;
		rerender(ui({onCompact: second, running: true}));
		fireEvent.click(button);
		expect(second).not.toHaveBeenCalled();
	});

	it("has no New session button without a starter", () => {
		render(ui({onNewSession: undefined}));
		expect(screen.queryByRole("button", {name: "New session"})).toBeNull();
		expect(screen.getByRole("button", {name: "Resume here"})).not.toBeNull();
	});

	it("hides while running and never re-shows for the stretch sent over", () => {
		const {rerender} = render(ui());
		rerender(ui({running: true}));
		expect(entries()).toBe("");
		rerender(ui({running: false}));
		expect(entries()).toBe("");
	});

	it("hides while input is held", () => {
		render(ui({heldInput: true}));
		expect(entries()).toBe("");
	});

	it("waits for window focus", () => {
		hasFocus = false;
		render(ui());
		expect(entries()).toBe("");
		hasFocus = true;
		act(() => {
			window.dispatchEvent(new Event("focus"));
		});
		expect(entries()).toBe(`eagerCookie=s1:${LAST}`);
	});

	it("checks again when the tab becomes visible", () => {
		visibility = "hidden";
		render(ui());
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(entries()).toBe("");
		visibility = "visible";
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(entries()).toBe(`eagerCookie=s1:${LAST}`);
	});

	it("crosses the 2h boundary on the minute check while focused", () => {
		vi.setSystemTime(LAST + 7_200_000 - 30_000);
		render(ui());
		expect(entries()).toBe("");
		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		expect(entries()).toBe(`eagerCookie=s1:${LAST}`);
	});

	it("checks on keydown inside the session footer", () => {
		vi.setSystemTime(LAST + 7_200_000 - 1000);
		render(ui());
		expect(entries()).toBe("");
		vi.setSystemTime(LAST + 7_200_000);
		act(() => {
			fireEvent.keyDown(screen.getByTestId("composer"), {key: "a"});
		});
		expect(entries()).toBe(`eagerCookie=s1:${LAST}`);
	});

	it("uses the rest copy when the cost reaches the remaining window", () => {
		render(ui({fiveHourPct: 90}));
		expect(banners()[0]?.querySelector("span.text-muted-as-secondary")?.textContent).toBe(
			"Idle 26 hours. Resuming will likely use the rest of your 5-hour limit.",
		);
	});

	it("shows again after a reload (store reset)", () => {
		const {unmount} = render(ui());
		fireEvent.click(screen.getByRole("button", {name: "Dismiss"}));
		unmount();
		resetColdResumeStore();
		render(ui());
		expect(entries()).toBe(`eagerCookie=s1:${LAST}`);
	});
});
