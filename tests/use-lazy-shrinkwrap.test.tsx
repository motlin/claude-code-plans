// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {useLazyShrinkwrap} from "../src/hooks/use-lazy-shrinkwrap";
import {loadedShrinkwrapEngine, loadShrinkwrapEngine} from "../src/lib/shrinkwrap-loader";

const engine = vi.hoisted(() => (
{
	events: [] as string[],
}));

vi.mock("../src/lib/shrinkwrap", () => (
{
	attachShrinkwrap: (el: HTMLElement, options: unknown) =>
	{
		engine.events.push(`fit ${el.id} ${JSON.stringify(options)}`);
		return () =>
		{
			engine.events.push(`dispose ${el.id}`);
		};
	},
	restoreShrinkwrap: (el: HTMLElement) =>
	{
		engine.events.push(`restore ${el.id}`);
	},
}));

afterEach(() =>
{
	cleanup();
	engine.events = [];
});

function Tip({id, enabled = true}: {id: string; enabled?: boolean})
{
	const ref = useLazyShrinkwrap(
		{
			enabled,
			immediate: true,
		},
	);
	return <span id={id} ref={ref} />;
}

// One file, one module registry: the first test sees the engine before its download, the rest after.
describe("useLazyShrinkwrap", () =>
{
	it("fits a still-attached element when the download lands, but not one detached or disabled meanwhile", async () =>
	{
		const {rerender, unmount} = render(<Tip id="first" />);
		const beforeDownload = [...engine.events];
		rerender(<Tip id="first" enabled={false} />);
		render(<Tip id="gone" />).unmount();
		render(<Tip id="waiting" />);
		await act(async () =>
		{
			await loadShrinkwrapEngine();
		});
		const afterDownload = [...engine.events];
		rerender(<Tip id="first" />);
		unmount();
		expect(
			{
				beforeDownload,
				afterDownload,
				after: engine.events,
			},
		).toStrictEqual(
			{
				beforeDownload: [],
				afterDownload: ['fit waiting {"immediate":true,"remember":true}'],
				after: [
					'fit waiting {"immediate":true,"remember":true}',
					'fit first {"immediate":true,"remember":true}',
					"dispose first",
				],
			},
		);
	});

	it("fits synchronously on attach once the engine is in hand", () =>
	{
		expect(loadedShrinkwrapEngine()).not.toBeUndefined();
		render(<Tip id="tip" />);
		expect(engine.events).toStrictEqual(['fit tip {"immediate":true,"remember":true}']);
	});
});
