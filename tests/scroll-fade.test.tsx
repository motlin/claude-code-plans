// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {createRef} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ScrollFade} from "../src/components/ui/scroll-fade";

afterEach(() => {
	cleanup();
});

const describeChildren = (root: Element) =>
	[...root.children].map((child) => ({
		tag: child.tagName,
		fade: child.getAttribute("data-scroll-fade"),
		hidden: child.getAttribute("aria-hidden"),
		className: child.className,
	}));

describe("ScrollFade", () => {
	it("ports upstream's ScrollFade: gated 32px/48px fade heights and surface strips around the children", () => {
		const ref = createRef<HTMLDivElement>();
		const {container} = render(
			<ScrollFade ref={ref} className="h-full" data-x="">
				<p />
			</ScrollFade>,
		);
		const root = container.firstElementChild!;

		expect({
			className: root.className,
			children: describeChildren(root),
			passthrough: root.getAttribute("data-x"),
			ref: ref.current === root,
		}).toStrictEqual({
			className:
				"overflow-y-auto supports-[animation-timeline:scroll()]:[--epitaxy-top-fade-height:32px] supports-[animation-timeline:scroll()]:[--epitaxy-bottom-fade-height:48px] h-full",
			children: [
				{
					tag: "DIV",
					fade: "top",
					hidden: "true",
					className:
						"scroll-fade-strip-top [--scroll-fade-size:var(--epitaxy-top-fade-height)] [--scroll-fade-strip-color:var(--epitaxy-transcript-surface,var(--color-surface-1))]",
				},
				{tag: "P", fade: null, hidden: null, className: ""},
				{
					tag: "DIV",
					fade: "bottom",
					hidden: "true",
					className:
						"scroll-fade-strip-bottom [--scroll-fade-size:var(--epitaxy-bottom-fade-height)] [--scroll-fade-strip-color:var(--epitaxy-transcript-surface,var(--color-surface-1))]",
				},
			],
			passthrough: "",
			ref: true,
		});
	});

	it("drops a strip and its height variable when that edge's fade is off", () => {
		const {container} = render(
			<ScrollFade className="h-full" topFade={false} bottomFade={false}>
				<p />
			</ScrollFade>,
		);
		const root = container.firstElementChild!;

		expect({className: root.className, children: describeChildren(root)}).toStrictEqual({
			className: "overflow-y-auto h-full",
			children: [{tag: "P", fade: null, hidden: null, className: ""}],
		});
	});
});
