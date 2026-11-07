// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {renderToString} from "react-dom/server";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {Phrases} from "../src/components/ui/phrases";
import {FizzyLakeContext, type FizzyLakePart} from "../src/lib/fizzy-lake";

const TYPE_OFF: readonly FizzyLakePart[] = ["color", "panels"];

class StubObserver {
	static instances: StubObserver[] = [];
	constructor(private readonly callback: ResizeObserverCallback) {
		StubObserver.instances.push(this);
	}
	observe() {}
	unobserve() {}
	disconnect() {}
	fire(targets: Element[]) {
		this.callback(
			targets.map((target) => ({target}) as ResizeObserverEntry),
			this,
		);
	}
}

describe("Phrases under fizzy-lake type (upstream shared-9 MG, cds-type-experiment-gate T3)", () => {
	const original = globalThis.ResizeObserver;

	beforeEach(() => {
		StubObserver.instances = [];
		globalThis.ResizeObserver = class extends StubObserver {};
	});

	afterEach(() => {
		cleanup();
		globalThis.ResizeObserver = original;
	});

	it("renders one ellipsis bdi with no probe and no inline styles", () => {
		const html = renderToString(<Phrases>{["Ran 2 commands", ", read a file"]}</Phrases>).replaceAll(
			"<!-- -->",
			"",
		);
		expect(html).toBe(
			'<span data-cds-phrases="all" class="relative block min-w-0 max-w-full"><bdi class="block overflow-x-clip whitespace-nowrap text-ellipsis">Ran 2 commands, read a file</bdi></span>',
		);
	});

	it("keeps one text node per phrase and drops empty phrases", () => {
		const {container} = render(<Phrases>{["Ran 2 commands", "", ", read a file"]}</Phrases>);
		const bdi = container.querySelector("bdi")!;
		expect([...bdi.childNodes].map((node) => [node.nodeType, node.textContent])).toStrictEqual([
			[Node.TEXT_NODE, "Ran 2 commands"],
			[Node.TEXT_NODE, ", read a file"],
		]);
	});

	it("fades the bdi with data-cds-row-cut while it overflows", () => {
		const {container} = render(<Phrases>{["Ran 2 commands", ", read a file"]}</Phrases>);
		const bdi = container.querySelector("bdi")!;
		Object.defineProperty(bdi, "scrollWidth", {configurable: true, value: 300});
		Object.defineProperty(bdi, "clientWidth", {configurable: true, value: 200});
		act(() => {
			StubObserver.instances[0]!.fire([bdi]);
		});
		expect(bdi.getAttribute("data-cds-row-cut")).toBe("");
	});

	it("renders the measuring probe when type is off and there are several phrases", () => {
		const {container} = render(
			<FizzyLakeContext.Provider value={TYPE_OFF}>
				<Phrases>{["Ran 2 commands", ", read a file"]}</Phrases>
			</FizzyLakeContext.Provider>,
		);
		expect({
			probe: container.querySelector("span.invisible.absolute.start-0.top-0")?.getAttribute("aria-hidden"),
			bdiClass: container.querySelector("bdi")?.className,
			observers: StubObserver.instances.length,
		}).toStrictEqual({probe: "true", bdiClass: "block overflow-x-clip whitespace-nowrap", observers: 0});
	});
});
