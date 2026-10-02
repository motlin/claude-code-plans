// @vitest-environment jsdom

import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	useLocation,
} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useReducer} from "react";
import {afterAll, afterEach, beforeAll, expect, it, vi} from "vite-plus/test";

import {useMainScrollRestoration} from "../src/hooks/use-main-scroll-restoration";

/** jsdom does no layout, so elements get a scrollTop that sticks and the scrollTo it lacks. */
const scrollTops = new WeakMap<Element, number>();
const nativeScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;

beforeAll(() => {
	Object.defineProperty(Element.prototype, "scrollTop", {
		configurable: true,
		get(this: Element) {
			return scrollTops.get(this) ?? 0;
		},
		set(this: Element, value: number) {
			scrollTops.set(this, value);
		},
	});
	Element.prototype.scrollTo = function scrollTo(this: Element, options?: ScrollToOptions | number) {
		if (typeof options === "object" && options.top !== undefined) this.scrollTop = options.top;
	} as Element["scrollTo"];
});

afterAll(() => {
	Object.defineProperty(Element.prototype, "scrollTop", nativeScrollTop);
	Reflect.deleteProperty(Element.prototype, "scrollTo");
});

afterEach(cleanup);

/** Like the session page: reads the restored <main> position for its location, and re-renders on demand. */
function RestoredMainPosition() {
	const [, rerender] = useReducer((count: number) => count + 1, 0);
	const locationKey = useLocation({select: (location) => location.state.__TSR_key ?? location.href});
	const restored = useMainScrollRestoration(locationKey);
	return (
		<button type="button" data-testid="restored" onClick={rerender}>
			{restored === undefined ? "none" : String(restored.scrollY)}
		</button>
	);
}

function makeRouter() {
	const rootRoute = createRootRoute({
		component: () => (
			<main data-testid="main" data-scroll-restoration-id="main">
				<Outlet />
			</main>
		),
	});
	const pageRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/session/$id",
		component: RestoredMainPosition,
	});
	return createRouter({
		scrollRestoration: true,
		routeTree: rootRoute.addChildren([pageRoute]),
		history: createMemoryHistory({initialEntries: ["/session/first"]}),
	});
}

/** The user scrolls <main>: the router tracks the position from the scroll event. */
function scrollMain(main: HTMLElement, top: number): void {
	main.scrollTop = top;
	main.dispatchEvent(new Event("scroll"));
}

/** What the page reads on a later re-render, after the router's post-render restoration pass has run. */
function restoredOnRerender(): string | null {
	fireEvent.click(screen.getByTestId("restored"));
	return screen.getByTestId("restored").textContent;
}

// One router per file: the router keeps its scroll-restoration cache and listeners at module level.
it("reports no restored <main> position for a fresh navigation, and the page's own position on Back", async () => {
	const router = makeRouter();
	await router.load();
	render(<RouterProvider router={router} />);
	const main = await screen.findByTestId("main");
	scrollMain(main, 13_939);

	// The router copies the left page's <main> entry into the new location's after it renders.
	await act(() => router.navigate({to: "/session/$id", params: {id: "second"}}));
	const afterSwitch = restoredOnRerender();
	scrollMain(main, 200);

	act(() => router.history.back());
	await vi.waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/session/first"));
	await act(async () => {});

	expect({afterSwitch, afterBack: restoredOnRerender(), scrollTopAfterBack: main.scrollTop}).toStrictEqual({
		afterSwitch: "none",
		afterBack: "13939",
		scrollTopAfterBack: 13_939,
	});
});
