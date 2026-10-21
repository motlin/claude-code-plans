// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionHoverCard} from "../src/components/session-hover-card";
import {ToastProvider} from "../src/components/toast";
import {DensityOverride, DensityScope, useDensity} from "../src/components/ui/density";
import {Menu, MenuContent, MenuItem, MenuTrigger, type MenuContentProps} from "../src/components/ui/menu";
import {ViewportPortal} from "../src/components/viewport-portal";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

type Listener = () => void;

function stubPointer(coarse: boolean) {
	const state = {matches: coarse, listeners: new Set<Listener>()};
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			get matches() {
				return query === "(pointer: coarse)" ? state.matches : false;
			},
			media: query,
			onchange: null,
			addEventListener: (_type: string, listener: Listener) => {
				if (query === "(pointer: coarse)") state.listeners.add(listener);
			},
			removeEventListener: (_type: string, listener: Listener) => {
				state.listeners.delete(listener);
			},
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
	return {
		setCoarse(matches: boolean) {
			state.matches = matches;
			for (const listener of state.listeners) listener();
		},
	};
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

function RowMenu({density}: Pick<MenuContentProps, "density">) {
	return (
		<Menu>
			<MenuTrigger aria-label="More options">...</MenuTrigger>
			<MenuContent {...(density === undefined ? {} : {density})}>
				<MenuItem>Copy link</MenuItem>
			</MenuContent>
		</Menu>
	);
}

async function openMenu() {
	fireEvent.click(screen.getByRole("button", {name: "More options"}));
	await flush();
	const menu = screen.getByRole("menu");
	const item = screen.getByRole("menuitem", {name: "Copy link"});
	return {
		scope: menu.parentElement?.closest("[data-density]")?.getAttribute("data-density"),
		item: item.className
			.split(" ")
			.filter((c) => ["h-6", "h-8", "text-[13px]/[19px]", "text-[14px]/[20px]"].includes(c)),
	};
}

function DensityProbe() {
	return <span data-testid="probe">{useDensity()}</span>;
}

describe("DensityScope", () => {
	it("marks a display:contents wrapper and provides its density, defaulting to comfortable as upstream's root scope", () => {
		render(
			<>
				<DensityProbe />
				<DensityScope density="compact">
					<DensityProbe />
				</DensityScope>
			</>,
		);
		const [outer, inner] = screen.getAllByTestId("probe");
		const wrapper = inner?.parentElement;

		expect({
			outer: outer?.textContent,
			inner: inner?.textContent,
			wrapper: {density: wrapper?.getAttribute("data-density"), className: wrapper?.className},
		}).toStrictEqual({
			outer: "comfortable",
			inner: "compact",
			wrapper: {density: "compact", className: "contents"},
		});
	});
});

function scopeOf(probe: HTMLElement | undefined) {
	const wrapper = probe?.parentElement;
	return {
		probe: probe?.textContent,
		wrapper: {density: wrapper?.getAttribute("data-density"), className: wrapper?.className},
	};
}

describe("DensityScope on a coarse pointer", () => {
	it("forces a compact scope comfortable, as upstream's si does under (pointer: coarse)", () => {
		stubPointer(true);
		render(
			<DensityScope density="compact">
				<DensityProbe />
			</DensityScope>,
		);

		expect(scopeOf(screen.getByTestId("probe"))).toStrictEqual({
			probe: "comfortable",
			wrapper: {density: "comfortable", className: "contents"},
		});
	});

	it("keeps the compact scope on a fine pointer", () => {
		stubPointer(false);
		render(
			<DensityScope density="compact">
				<DensityProbe />
			</DensityScope>,
		);

		expect(scopeOf(screen.getByTestId("probe"))).toStrictEqual({
			probe: "compact",
			wrapper: {density: "compact", className: "contents"},
		});
	});

	it("lets a density override win over the coarse pointer, as upstream's densityOverride ?? coarse order", () => {
		stubPointer(true);
		render(
			<DensityOverride density="compact">
				<DensityScope density="comfortable">
					<DensityProbe />
				</DensityScope>
			</DensityOverride>,
		);

		expect(scopeOf(screen.getByTestId("probe"))).toStrictEqual({
			probe: "compact",
			wrapper: {density: "compact", className: "contents"},
		});
	});

	it("switches live when the pointer type changes, without remounting", () => {
		const pointer = stubPointer(false);
		render(
			<DensityScope density="compact">
				<DensityProbe />
			</DensityScope>,
		);
		const before = screen.getByTestId("probe");
		act(() => {
			pointer.setCoarse(true);
		});
		const after = screen.getByTestId("probe");

		expect({sameNode: before === after, ...scopeOf(after)}).toStrictEqual({
			sameNode: true,
			probe: "comfortable",
			wrapper: {density: "comfortable", className: "contents"},
		});
	});

	it("portals a hover card opened inside the compact scope as comfortable", async () => {
		stubPointer(true);
		vi.useFakeTimers();
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
		render(
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<DensityScope density="compact">
						<SessionHoverCard
							sessionId="s1"
							title="Ship it"
							summary="Shipped the rail"
							aiTitle={null}
							blocked={false}
							render={<div data-testid="row" />}
						>
							Ship it
						</SessionHoverCard>
					</DensityScope>
				</ToastProvider>
			</QueryClientProvider>,
		);
		const row = screen.getByTestId("row");
		act(() => {
			fireEvent.pointerEnter(row, {pointerType: "mouse"});
			fireEvent.mouseEnter(row);
			fireEvent.mouseMove(row);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(600);
		});
		const card = document.querySelector("[data-session-hover-card]");

		expect({
			portaled: card !== null && !row.contains(card),
			scope: card?.closest("[data-density]")?.getAttribute("data-density"),
		}).toStrictEqual({portaled: true, scope: "comfortable"});
	});
});

describe("portals inherit their opener's density", () => {
	it("opens a menu from the compact main column under a compact portal with 24px rows", async () => {
		render(
			<DensityScope density="compact">
				<RowMenu />
			</DensityScope>,
		);

		expect(await openMenu()).toStrictEqual({scope: "compact", item: ["h-6", "text-[13px]/[19px]"]});
	});

	it("opens the same menu from the comfortable shell (the sidebar) under a comfortable portal with 32px rows", async () => {
		render(<RowMenu />);

		expect(await openMenu()).toStrictEqual({scope: "comfortable", item: ["h-8", "text-[14px]/[20px]"]});
	});

	it("lets an explicit density prop win inside main, as upstream forces the session header menu comfortable", async () => {
		render(
			<DensityScope density="compact">
				<RowMenu density="comfortable" />
			</DensityScope>,
		);

		expect(await openMenu()).toStrictEqual({scope: "comfortable", item: ["h-8", "text-[14px]/[20px]"]});
	});

	it("portals a main-column hover card into a compact wrapper", async () => {
		vi.useFakeTimers();
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
		render(
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<DensityScope density="compact">
						<SessionHoverCard
							sessionId="s1"
							title="Ship it"
							summary="Shipped the rail"
							aiTitle={null}
							blocked={false}
							render={<div data-testid="row" />}
						>
							Ship it
						</SessionHoverCard>
					</DensityScope>
				</ToastProvider>
			</QueryClientProvider>,
		);
		const row = screen.getByTestId("row");
		act(() => {
			fireEvent.pointerEnter(row, {pointerType: "mouse"});
			fireEvent.mouseEnter(row);
			fireEvent.mouseMove(row);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(600);
		});
		const card = document.querySelector("[data-session-hover-card]");

		expect({
			portaled:
				card !== null &&
				!row.contains(card) &&
				row.closest("[data-density]") !== card.closest("[data-density]"),
			scope: card?.closest("[data-density]")?.getAttribute("data-density"),
		}).toStrictEqual({portaled: true, scope: "compact"});
	});

	it("wraps viewport-portaled tooltips in the opener's density", () => {
		render(
			<DensityScope density="compact">
				<ViewportPortal>
					<span data-testid="tip">Tip</span>
				</ViewportPortal>
			</DensityScope>,
		);
		const tip = screen.getByTestId("tip");

		expect({
			parentIsBody: tip.parentElement?.parentElement === document.body,
			scope: tip.closest("[data-density]")?.getAttribute("data-density"),
		}).toStrictEqual({parentIsBody: true, scope: "compact"});
	});
});
