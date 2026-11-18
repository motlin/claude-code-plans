// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {slideThumb} from "../src/components/palette-thumb-measure";

function card()
{
	const el = document.body.appendChild(document.createElement("div"));
	el.style.setProperty("--cds-dur-snap", "0.12s");
	el.style.setProperty("--cds-ease-out", "cubic-bezier(0.165, 0.84, 0.44, 1)");
	const animate = vi.fn<HTMLElement["animate"]>();
	Object.assign(
		el,
		{
			animate,
			getAnimations: () => [],
		},
	);
	return {
		el,
		animate,
	};
}

describe("slideThumb", () =>
{
	afterEach(() =>
	{
		document.body.replaceChildren();
		document.documentElement.removeAttribute("data-reduce-motion");
	});

	it("slides from the old row's spot to the new one over duration-snap", () =>
	{
		const {el, animate} = card();

		expect(
			{
				slid: slideThumb(el, 148, 184),
				calls: animate.mock.calls,
			},
		).toStrictEqual(
			{
				slid: true,
				calls: [
					[
						{
							transform: ["translateY(-36px)", "translateY(0)"],
						},
						{
							duration: 120,
							easing: "cubic-bezier(0.165, 0.84, 0.44, 1)",
						},
					],
				],
			},
		);
	});

	it("doesn't slide under reduced motion or to the same spot", () =>
	{
		const {el, animate} = card();
		const same = slideThumb(el, 148, 148);
		document.documentElement.setAttribute("data-reduce-motion", "true");

		expect(
			{
				same,
				reduced: slideThumb(el, 148, 184),
				calls: animate.mock.calls,
			},
		).toStrictEqual(
			{
				same: false,
				reduced: false,
				calls: [],
			},
		);
	});
});
