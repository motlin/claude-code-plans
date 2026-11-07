// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {HomePage} from "../src/components/home/home-page";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("HomePage gutters", () => {
	it("makes the tile a tile-slot container and narrows the column to upstream's 16px/24px gutters when that tile is ≤560px", () => {
		const {container} = render(
			<QueryClientProvider client={new QueryClient()}>
				<HomePage dock={<div data-test-dock />}>
					<div data-test-body />
				</HomePage>
			</QueryClientProvider>,
		);
		const gutters = (element: Element | null | undefined) =>
			(element?.className.split(" ") ?? []).filter((name) => /^(\[@container[^\]]*\]:)?p[lr]-/.test(name));
		const tile = [
			"pr-10",
			"pl-8",
			"[@container_tile-slot_(max-width:560px)]:pr-6",
			"[@container_tile-slot_(max-width:560px)]:pl-4",
		];
		expect({
			container: container.firstElementChild?.className.split(" ").includes("@container/tile-slot"),
			body: gutters(container.querySelector("[data-home-body]")?.parentElement),
			dock: gutters(container.querySelector("[data-test-dock]")?.parentElement),
		}).toStrictEqual({container: true, body: tile, dock: tile});
	});

	it("wraps the landing column in upstream's ScrollFade strips, keeps its fade scroll padding, and its scroll-fade-y only while the content overflows", () => {
		const callbacks: ResizeObserverCallback[] = [];
		const observed: Element[] = [];
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: ResizeObserverCallback) {
					callbacks.push(callback);
				}
				observe(element: Element) {
					observed.push(element);
				}
				unobserve() {}
				disconnect() {}
			},
		);
		const {container} = render(
			<QueryClientProvider client={new QueryClient()}>
				<HomePage>
					<div data-test-body />
				</HomePage>
			</QueryClientProvider>,
		);
		const body = container.querySelector<HTMLElement>("[data-home-body]");
		if (body === null) throw new Error("no home body");
		const measure = (scrollHeight: number, clientHeight: number) => {
			Object.defineProperty(body, "scrollHeight", {configurable: true, value: scrollHeight});
			Object.defineProperty(body, "clientHeight", {configurable: true, value: clientHeight});
			act(() => {
				for (const callback of callbacks) callback([], {} as ResizeObserver);
			});
			return body.getAttribute("data-landing-overflows");
		};

		expect({
			className: body.className,
			fades: [...body.children].map((child) => child.getAttribute("data-scroll-fade")),
			content: body.children[1]?.hasAttribute("data-test-body"),
			observed: observed.map((element) =>
				element === body
					? "scroller"
					: (element.getAttribute("data-scroll-fade") ?? element.getAttributeNames().join()),
			),
			overflowing: measure(900, 600),
			fitting: measure(600, 600),
			withinOnePixel: measure(601, 600),
		}).toStrictEqual({
			className:
				"overflow-y-auto supports-[animation-timeline:scroll()]:[--epitaxy-top-fade-height:32px] supports-[animation-timeline:scroll()]:[--epitaxy-bottom-fade-height:48px] min-h-0 flex-1 overflow-x-hidden u-hidden-scrollbar scroll-py-(--scroll-fade-size) data-[landing-overflows]:scroll-fade-y",
			fades: ["top", null, "bottom"],
			content: true,
			observed: ["scroller", "data-test-body"],
			overflowing: "",
			fitting: null,
			withinOnePixel: null,
		});
	});
});
