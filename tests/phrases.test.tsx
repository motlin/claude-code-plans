// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {renderToString} from "react-dom/server";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {Phrases} from "../src/components/ui/phrases";
import {FizzyLakeContext, type FizzyLakePart} from "../src/lib/fizzy-lake";

class StubObserver
{
	static instances: StubObserver[] = [];
	constructor(private readonly callback: ResizeObserverCallback)
	{
		StubObserver.instances.push(this);
	}
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
	fire(targets: Element[])
	{
		this.callback(
			targets.map(
				(target) =>
					(
					{
						target,
					}) as ResizeObserverEntry,
			),
			this,
		);
	}
}

describe("Phrases (upstream shared-9 MG, live 2026-11-21: no measuring path, no type gate)", () =>
{
	const original = globalThis.ResizeObserver;

	beforeEach(() =>
	{
		StubObserver.instances = [];
		globalThis.ResizeObserver = class extends StubObserver
		{
		};
	});

	afterEach(() =>
	{
		cleanup();
		globalThis.ResizeObserver = original;
	});

	it("renders one ellipsis bdi in a bare data-cds-phrases span under any fizzy-lake parts", () =>
	{
		const markup = (parts: readonly FizzyLakePart[]) =>
			renderToString(
				<FizzyLakeContext.Provider value={parts}>
					<Phrases>{["Ran 2 commands", ", read a file"]}</Phrases>
				</FizzyLakeContext.Provider>,
			).replaceAll("<!-- -->", "");
		const expected =
			'<span data-cds-phrases="" class="block min-w-0 max-w-full"><bdi class="block overflow-x-clip text-ellipsis whitespace-nowrap">Ran 2 commands, read a file</bdi></span>';
		expect([markup(["color", "panels", "type"]), markup(["color", "panels"])]).toStrictEqual([expected, expected]);
	});

	it("keeps one text node per phrase and drops empty phrases", () =>
	{
		const {container} = render(<Phrases>{["Ran 2 commands", "", ", read a file"]}</Phrases>);
		const bdi = container.querySelector("bdi")!;
		expect([...bdi.childNodes].map((node) => [node.nodeType, node.textContent])).toStrictEqual([
			[Node.TEXT_NODE, "Ran 2 commands"],
			[Node.TEXT_NODE, ", read a file"],
		]);
	});

	it("fades the bdi with data-cds-row-cut while it overflows", () =>
	{
		const {container} = render(<Phrases>{["Ran 2 commands", ", read a file"]}</Phrases>);
		const bdi = container.querySelector("bdi")!;
		Object.defineProperty(
			bdi,
			"scrollWidth",
			{
				configurable: true,
				value: 300,
			},
		);
		Object.defineProperty(
			bdi,
			"clientWidth",
			{
				configurable: true,
				value: 200,
			},
		);
		act(() =>
		{
			StubObserver.instances[0]!.fire([bdi]);
		});
		expect(bdi.getAttribute("data-cds-row-cut")).toBe("");
	});
});
