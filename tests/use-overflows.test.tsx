// @vitest-environment jsdom

import {act, render} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {useOverflows} from "../src/hooks/use-overflows";

const callbacks: ResizeObserverCallback[] = [];
const observed = new Set<Element>();
let disconnects = 0;

class CapturingResizeObserver
{
	constructor(callback: ResizeObserverCallback)
	{
		callbacks.push(callback);
	}
	observe(target: Element)
	{
		observed.add(target);
	}
	unobserve(target: Element)
	{
		observed.delete(target);
	}
	disconnect()
	{
		disconnects += 1;
	}
	takeRecords()
	{
		return [];
	}
}

beforeEach(() =>
{
	callbacks.length = 0;
	observed.clear();
	disconnects = 0;
	vi.stubGlobal("ResizeObserver", CapturingResizeObserver);
});

afterEach(() =>
{
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function Probe()
{
	const ref = useRef<HTMLDivElement>(null);
	const overflows = useOverflows(ref, "children");
	return (
		<div ref={ref} data-testid="probe" data-overflows={String(overflows)}>
			<span>first</span>
		</div>
	);
}

describe("useOverflows (upstream cf0704cb0)", () =>
{
	it("follows scrollHeight > clientHeight through resizes and observes each element child as it comes and goes", async () =>
	{
		const view = render(<Probe />);
		const probe = view.getByTestId("probe");
		const first = probe.firstElementChild!;
		const state = () => probe.getAttribute("data-overflows");
		const before = state();
		const observedAtMount = [...observed].map((element) => element === probe || element === first);
		vi.spyOn(probe, "scrollHeight", "get").mockReturnValue(200);
		vi.spyOn(probe, "clientHeight", "get").mockReturnValue(100);
		act(() =>
		{
			for (const callback of callbacks) callback([], {} as ResizeObserver);
		});
		const afterResize = state();
		const added = document.createElement("p");
		probe.append(added);
		await act(async () => Promise.resolve());
		const observedChildren = observed.has(added);
		vi.spyOn(probe, "scrollHeight", "get").mockReturnValue(100);
		added.remove();
		await act(async () => Promise.resolve());
		const afterRemove =
		{
			overflows: state(),
			observed: observed.has(added),
		};
		view.unmount();
		expect(
			{
				before,
				observedAtMount,
				afterResize,
				observedChildren,
				afterRemove,
				disconnects,
			},
		).toStrictEqual(
			{
				before: "false",
				observedAtMount: [true, true],
				afterResize: "true",
				observedChildren: true,
				afterRemove:
				{
					overflows: "false",
					observed: false,
				},
				disconnects: 1,
			},
		);
	});
});
