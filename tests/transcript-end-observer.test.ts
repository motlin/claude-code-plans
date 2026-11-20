// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {observeTranscriptEnd, type TranscriptEndState} from "../src/lib/transcript-end-observer";

class FakeIntersectionObserver
{
	static instances: FakeIntersectionObserver[] = [];

	readonly callback: IntersectionObserverCallback;
	readonly rootMargin: string;
	readonly root: Element | Document | null;
	disconnected = false;

	constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit)
	{
		this.callback = callback;
		this.rootMargin = options.rootMargin ?? "";
		this.root = options.root ?? null;
		FakeIntersectionObserver.instances.push(this);
	}

	observe()
	{
	}
	disconnect()
	{
		this.disconnected = true;
	}

	report(isIntersecting: boolean)
	{
		this.callback(
			[
				{
					isIntersecting,
				} as IntersectionObserverEntry,
			],
			this as unknown as IntersectionObserver,
		);
	}
}

class FakeResizeObserver
{
	static instances: FakeResizeObserver[] = [];

	readonly callback: ResizeObserverCallback;

	constructor(callback: ResizeObserverCallback)
	{
		this.callback = callback;
		FakeResizeObserver.instances.push(this);
	}

	observe()
	{
	}
	disconnect()
	{
	}

	resize()
	{
		this.callback([], this as unknown as ResizeObserver);
	}
}

function overlayOfHeight(height: () => number): HTMLElement
{
	const overlay = document.createElement("div");
	overlay.getBoundingClientRect = () =>
		(
		{
			height: height(),
		}) as DOMRect;
	return overlay;
}

const live = () => FakeIntersectionObserver.instances.filter((observer) => !observer.disconnected);

beforeEach(() =>
{
	FakeIntersectionObserver.instances = [];
	FakeResizeObserver.instances = [];
	vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() =>
{
	vi.unstubAllGlobals();
});

describe("observeTranscriptEnd (upstream y0)", () =>
{
	it("watches the sentinel 8px and 200px below the overlay top, rebuilding when the overlay resizes", () =>
	{
		let height = 0;
		const scroller = document.createElement("div");
		const observer = observeTranscriptEnd(
			{
				scroller,
				sentinel: document.createElement("div"),
				overlay: overlayOfHeight(() => height),
				isFollowing: () => false,
				onChange: () =>
				{
				},
			},
		);
		const withoutOverlay = live().map((entry) => [entry.rootMargin, entry.root === scroller]);
		height = 329;
		FakeResizeObserver.instances[0]!.resize();
		const withOverlay = live().map((entry) => entry.rootMargin);
		observer.disconnect();

		expect(
			{
				withoutOverlay,
				withOverlay,
				afterDisconnect: live().length,
			},
		).toStrictEqual(
			{
				withoutOverlay: [
					["0px 0px 8px 0px", true],
					["0px 0px 200px 0px", true],
				],
				withOverlay: ["0px 0px -321px 0px", "0px 0px -129px 0px"],
				afterDisconnect: 0,
			},
		);
	});

	it("shows the jump control past 200px and the fade past 8px, neither while following, emitting only changes", () =>
	{
		let following = true;
		const states: TranscriptEndState[] = [];
		const observer = observeTranscriptEnd(
			{
				scroller: document.createElement("div"),
				sentinel: document.createElement("div"),
				overlay: null,
				isFollowing: () => following,
				onChange: (state) =>
				{
					states.push(state);
				},
			},
		);
		const [fade, jump] = live();
		fade!.report(false);
		jump!.report(false);
		following = false;
		observer.refresh();
		jump!.report(true);

		expect(states).toStrictEqual([
			{
				following: false,
				showJumpControl: true,
				showBottomFade: true,
			},
			{
				following: false,
				showJumpControl: false,
				showBottomFade: true,
			},
		]);
	});
});
