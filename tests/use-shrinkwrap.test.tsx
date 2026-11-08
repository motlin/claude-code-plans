// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {useCallback, useLayoutEffect} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {useShrinkwrap} from "../src/hooks/use-shrinkwrap";
import {attachShrinkwrap, needsRefit} from "../src/lib/shrinkwrap";
import {installFakeLayout, type FakeLayout} from "./shrinkwrap-fake-layout";

type Callback = (entries: ResizeObserverEntry[]) => void;

class FakeResizeObserver {
	static instances: FakeResizeObserver[] = [];
	readonly targets = new Set<Element>();
	disconnected = false;
	constructor(readonly callback: Callback) {
		FakeResizeObserver.instances.push(this);
	}
	observe(el: Element) {
		this.targets.add(el);
	}
	unobserve(el: Element) {
		this.targets.delete(el);
	}
	disconnect() {
		this.disconnected = true;
		this.targets.clear();
	}
	fire(target: Element, inline: number, block: number) {
		this.callback([
			{
				target,
				borderBoxSize: [{inlineSize: inline, blockSize: block}],
				contentRect: {width: inline, height: block},
			} as unknown as ResizeObserverEntry,
		]);
	}
}

let layout: FakeLayout | undefined;
const disposers: (() => void)[] = [];

/** Attach and remember the cleanup, so a test's shared ResizeObserver never leaks into the next. */
function attach(el: HTMLElement, options?: {remember?: boolean}): () => void {
	const dispose = attachShrinkwrap(el, options);
	disposers.push(dispose);
	return dispose;
}

beforeEach(() => {
	FakeResizeObserver.instances = [];
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
	vi.stubGlobal("requestAnimationFrame", () => 1);
	vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
	cleanup();
	for (const dispose of disposers.splice(0)) dispose();
	layout?.uninstall();
	layout = undefined;
	vi.unstubAllGlobals();
	Reflect.deleteProperty(window, "ResizeObserver");
	document.body.innerHTML = "";
});

const flushMicrotasks = async () => act(async () => {});

function Bubble({enabled, text = "prompt"}: {enabled?: boolean; text?: string}) {
	const ref = useShrinkwrap(enabled === undefined ? {} : {enabled});
	return (
		<div data-testid="outer">
			<div data-testid="bubble" ref={ref}>
				<p>{text}</p>
			</div>
		</div>
	);
}

/** Mount the bubble with a scripted layout installed before the first fit. */
function mount(lines: (w: number) => number[]) {
	const container = document.createElement("div");
	document.body.append(container);
	const bubble = document.createElement("div");
	bubble.innerHTML = "<p>prompt</p>";
	container.append(bubble);
	layout = installFakeLayout(bubble, {box: 652, pad: 32, lines});
	return {container, bubble, cleanup: attach(bubble)};
}

describe("needsRefit (upstream Iz)", () => {
	it("refits an ancestor only on an inline change over 1px", () => {
		const base = {self: false, block: 10, prevBlock: 10, applied: 600};
		expect([
			needsRefit({...base, inline: 805, prevInline: 800}),
			needsRefit({...base, inline: 800.5, prevInline: 800}),
		]).toEqual([true, false]);
	});

	it("ignores the element's own resize to the applied width but refits on a block change", () => {
		const base = {self: true, applied: 632};
		expect([
			needsRefit({...base, inline: 632, prevInline: 652, block: 88, prevBlock: 88}),
			needsRefit({...base, inline: 640, prevInline: 632, block: 88, prevBlock: 88}),
			needsRefit({...base, inline: 632, prevInline: 632, block: 112, prevBlock: 88}),
		]).toEqual([false, true, true]);
	});
});

describe("attachShrinkwrap (upstream xT)", () => {
	it("fits in a microtask, not synchronously", async () => {
		const {bubble} = mount(() => [600, 580, 420]);
		const before = bubble.style.maxWidth;
		await flushMicrotasks();
		expect({before, after: bubble.style.maxWidth}).toEqual({before: "", after: "632px"});
	});

	it("watches the element and its ancestors with one shared ResizeObserver", async () => {
		const {bubble, container} = mount(() => [600]);
		await flushMicrotasks();
		const [observer] = FakeResizeObserver.instances;
		expect({
			count: FakeResizeObserver.instances.length,
			watchesBubble: observer?.targets.has(bubble),
			watchesParent: observer?.targets.has(container),
			watchesBody: observer?.targets.has(document.body),
		}).toEqual({count: 1, watchesBubble: true, watchesParent: true, watchesBody: true});
	});

	it("refits when an ancestor grows by more than 1px, but not by half a pixel", async () => {
		let widest = 600;
		const {container, bubble} = mount(() => [widest]);
		await flushMicrotasks();
		const observer = FakeResizeObserver.instances[0];
		widest = 500;
		observer?.fire(container, container.offsetWidth + 0.5, 0);
		const afterHalf = bubble.style.maxWidth;
		observer?.fire(container, container.offsetWidth + 5, 0);
		expect({afterHalf, afterFive: bubble.style.maxWidth}).toEqual({afterHalf: "632px", afterFive: "532px"});
	});

	it("refits on a subtree text mutation", async () => {
		const {bubble} = mount(() => (bubble.textContent === "prompt" ? [600] : [400]));
		await flushMicrotasks();
		const first = bubble.style.maxWidth;
		bubble.querySelector("p")!.textContent = "shorter";
		await flushMicrotasks();
		await flushMicrotasks();
		expect({first, second: bubble.style.maxWidth}).toEqual({first: "632px", second: "432px"});
	});

	it("cleanup disconnects and restores the element's own inline max-width", async () => {
		const {bubble, cleanup: dispose} = mount(() => [600]);
		await flushMicrotasks();
		dispose();
		expect({style: bubble.style.maxWidth, disconnected: FakeResizeObserver.instances[0]?.disconnected}).toEqual({
			style: "",
			disconnected: true,
		});
	});

	it("re-applies a remembered width on remount without probing (shrinkWrapMemory)", async () => {
		const container = document.createElement("div");
		Object.defineProperty(container, "offsetWidth", {configurable: true, get: () => 800});
		document.body.append(container);
		const first = document.createElement("div");
		first.innerHTML = "<p>prompt</p>";
		container.append(first);
		layout = installFakeLayout(first, {box: 652, pad: 32, lines: () => [600, 580, 420]});
		const disposeFirst = attach(first, {remember: true});
		await flushMicrotasks();
		const firstProbes = layout.probes().length;
		disposeFirst();
		first.remove();
		layout.uninstall();

		const second = document.createElement("div");
		second.innerHTML = "<p>prompt</p>";
		container.append(second);
		layout = installFakeLayout(second, {box: 652, pad: 32, lines: () => [600, 580, 420]});
		attach(second, {remember: true});
		await flushMicrotasks();
		expect({firstProbes, secondProbes: layout.probes(), style: second.style.maxWidth}).toEqual({
			firstProbes: 1,
			secondProbes: [632],
			style: "632px",
		});
	});
});

describe("useShrinkwrap (upstream an)", () => {
	it("attaches on mount and restores on unmount", async () => {
		const {getByTestId, unmount} = render(<Bubble />);
		const bubble = getByTestId("bubble");
		layout = installFakeLayout(bubble, {box: 652, pad: 32, lines: () => [500]});
		await flushMicrotasks();
		const mounted = bubble.style.maxWidth;
		unmount();
		expect({mounted, unmounted: bubble.style.maxWidth}).toEqual({mounted: "532px", unmounted: ""});
	});

	it("leaves no style when disabled", async () => {
		const {getByTestId} = render(<Bubble enabled={false} />);
		const bubble = getByTestId("bubble");
		layout = installFakeLayout(bubble, {box: 652, pad: 32, lines: () => [500]});
		await flushMicrotasks();
		expect(bubble.style.maxWidth).toBe("");
	});

	it("fits synchronously during the commit when immediate, before any microtask", () => {
		const seen: Record<string, string> = {};
		function Fitted({immediate}: {immediate: boolean}) {
			const fit = useShrinkwrap({immediate});
			const ref = useCallback(
				(el: HTMLElement | null) => {
					if (el !== null) layout = installFakeLayout(el, {box: 652, pad: 32, lines: () => [148]});
					fit(el);
				},
				[fit],
			);
			return (
				<div>
					<div data-testid={immediate ? "immediate" : "deferred"} ref={ref}>
						<p>prompt</p>
					</div>
				</div>
			);
		}
		function Probe({id}: {id: string}) {
			useLayoutEffect(() => {
				seen[id] = document.querySelector<HTMLElement>(`[data-testid=${id}]`)?.style.maxWidth ?? "missing";
			});
			return null;
		}
		render(
			<>
				<Fitted immediate />
				<Probe id="immediate" />
			</>,
		);
		layout?.uninstall();
		render(
			<>
				<Fitted immediate={false} />
				<Probe id="deferred" />
			</>,
		);
		expect(seen).toStrictEqual({immediate: "180px", deferred: ""});
	});
});
