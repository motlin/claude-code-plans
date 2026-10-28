// @vitest-environment jsdom

import {act, cleanup, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {CodePageHeader} from "../src/components/code-page-header";

afterEach(cleanup);

describe("CodePageHeader", () => {
	it("sets upstream's compact 24/32 serif title over a tab row that carries the toolbar on its right", () => {
		render(
			<CodePageHeader
				title="Artifacts"
				tabs={<div role="tablist" aria-label="Views" />}
				toolbar={<button type="button">Search</button>}
			/>,
		);
		const title = screen.getByRole("heading", {level: 1, name: "Artifacts"});
		const tabs = screen.getByRole("tablist", {name: "Views"});
		const toolbar = screen.getByRole("button", {name: "Search"});
		expect({
			title: title.className
				.split(" ")
				.filter((name) => ["font-voice", "text-[24px]/[32px]", "font-medium"].includes(name)),
			sameRow: tabs.parentElement === toolbar.parentElement?.parentElement,
			toolbarRight: toolbar.parentElement?.className.split(" ").includes("ms-auto"),
		}).toStrictEqual({
			title: ["font-voice", "text-[24px]/[32px]", "font-medium"],
			sameRow: true,
			toolbarRight: true,
		});
	});

	it("pulls the title up only from sm, so at phone width it starts at the 48px band below the sidebar trigger", () => {
		render(<CodePageHeader title="Projects" />);
		expect(screen.getByRole("heading", {level: 1, name: "Projects"}).parentElement?.className).toBe(
			"flex flex-col pb-4 sm:-mt-1",
		);
	});
});

describe("CodePageHeader sticky", () => {
	let observed: {callback: IntersectionObserverCallback; target: Element | null; disconnected: boolean}[] = [];
	class TestIntersectionObserver {
		readonly record: (typeof observed)[number];
		constructor(callback: IntersectionObserverCallback) {
			this.record = {callback, target: null, disconnected: false};
			observed.push(this.record);
		}
		observe(target: Element): void {
			this.record.target = target;
		}
		disconnect(): void {
			this.record.disconnected = true;
		}
	}
	beforeEach(() => {
		observed = [];
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("pins upstream's sticky bg-page band over a content box and shows the fade only once the h-0 sentinel scrolls away", () => {
		const {container} = render(
			<CodePageHeader title="Artifacts" sticky={{box: "mx-auto w-full max-w-5xl px-2 md:px-8"}} />,
		);
		const header = screen.getByRole("heading", {level: 1, name: "Artifacts"}).parentElement;
		const box = header?.parentElement;
		const band = box?.parentElement;
		const fade = container.querySelector('[data-cds-part="fade"]');
		const sentinel = band?.previousElementSibling;
		const scrolled = (isIntersecting: boolean) => {
			act(() => {
				observed[0]?.callback([{isIntersecting} as IntersectionObserverEntry], {} as IntersectionObserver);
			});
			return fade?.className;
		};
		expect({
			header: header?.className,
			box: box?.className,
			band: band?.className,
			bandZ: band instanceof HTMLElement ? band.style.zIndex : null,
			sentinel: sentinel?.className,
			observes: observed.map((record) => record.target === sentinel),
			fadeParent: fade?.parentElement === band,
			fadeHidden: fade?.getAttribute("aria-hidden"),
			atRest: fade?.className,
			afterScroll: scrolled(false),
			backAtTop: scrolled(true),
		}).toStrictEqual({
			header: "flex flex-col sm:-mt-1",
			// The sentinel (so the band) rises over RootTopRow's 36px (48px phone) spacer and pads it back, so the pinned band keeps
			// upstream's whitespace above the title (its 64px title row) instead of pinning the title flush at the top.
			box: "mx-auto w-full max-w-5xl px-2 md:px-8 pt-9 max-sm:pt-12 pb-6",
			band: "sticky top-0 bg-page",
			bandZ: "20",
			sentinel: "h-0 -mt-9 max-sm:-mt-12",
			observes: [true],
			fadeParent: true,
			fadeHidden: "true",
			atRest: "page-fade-t absolute inset-x-0 -bottom-8 h-8 transition-[opacity,visibility] invisible opacity-0",
			afterScroll:
				"page-fade-t absolute inset-x-0 -bottom-8 h-8 transition-[opacity,visibility] visible opacity-100",
			backAtTop:
				"page-fade-t absolute inset-x-0 -bottom-8 h-8 transition-[opacity,visibility] invisible opacity-0",
		});
	});
});
