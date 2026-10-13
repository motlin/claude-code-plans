// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {NavScroll} from "../src/components/sidebar/nav-scroll";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const ROW_HEIGHT = 32;
const VIEW = {top: 125, bottom: 730};

/** Lay rows out on a 32px pitch inside a 605px scroller at y=125, as the real sidebar does. */
function layOut(scroller: HTMLElement): void {
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
		if (this === scroller) return DOMRect.fromRect({x: 4, y: VIEW.top, width: 284, height: VIEW.bottom - VIEW.top});
		const index = Number(this.dataset["index"] ?? 0);
		return DOMRect.fromRect({
			x: 8,
			y: VIEW.top + index * ROW_HEIGHT - scroller.scrollTop,
			width: 269,
			height: ROW_HEIGHT,
		});
	});
}

function rows(count: number, active: number | null) {
	return Array.from({length: count}, (_, index) => (
		<a
			key={index}
			data-index={index}
			data-row-main-button=""
			data-selected={index === active ? "focused" : undefined}
			href={`#${index}`}
		>
			Session {index}
		</a>
	));
}

describe("NavScroll", () => {
	it("scrolls the active session row up into view, bottom-aligned, once its row renders", async () => {
		const {getByTestId, rerender} = render(<NavScroll activeKey="session-35">{rows(0, null)}</NavScroll>);
		const scroller = getByTestId("nav-scroll");
		layOut(scroller);
		await act(async () => {
			rerender(<NavScroll activeKey="session-35">{rows(40, 35)}</NavScroll>);
			await Promise.resolve();
		});

		// Row 35 spans 1245-1277 unscrolled; the 605px view ends at 730.
		expect(scroller.scrollTop).toBe(35 * ROW_HEIGHT + ROW_HEIGHT - (VIEW.bottom - VIEW.top));
	});

	it("leaves the scroll alone when the active row is already visible", async () => {
		const {getByTestId, rerender} = render(<NavScroll activeKey="session-3">{rows(0, null)}</NavScroll>);
		const scroller = getByTestId("nav-scroll");
		layOut(scroller);
		await act(async () => {
			rerender(<NavScroll activeKey="session-3">{rows(40, 3)}</NavScroll>);
			await Promise.resolve();
		});

		expect(scroller.scrollTop).toBe(0);
	});
});
