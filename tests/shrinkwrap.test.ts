// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";
import {fitShrinkwrap, SHRINKWRAP_ATTR, SHRINKWRAP_FILL} from "../src/lib/shrinkwrap";
import {installFakeLayout, type FakeLayout} from "./shrinkwrap-fake-layout";

let layout: FakeLayout | undefined;

afterEach(() =>
{
	layout?.uninstall();
	layout = undefined;
	document.body.innerHTML = "";
});

/** A bubble with a text paragraph, mounted into the document. */
function bubble(html = "<p>prompt text</p>"): HTMLElement
{
	const el = document.createElement("div");
	el.innerHTML = html;
	document.body.append(el);
	return el;
}

const three = () => [600, 580, 420];

describe("fitShrinkwrap (upstream shared-frame mX + cU/lm)", () =>
{
	it("hugs the widest line plus padding when the lines keep their widths", () =>
	{
		const el = bubble();
		layout = installFakeLayout(
			el,
			{
				box: 652,
				pad: 32,
				lines: three,
			},
		);
		expect(
			{
				width: fitShrinkwrap(el),
				style: el.style.maxWidth,
			},
		).toEqual(
			{
				width: 632,
				style: "632px",
			},
		);
	});

	it("nudges by +1 and +2 when the candidate rewraps", () =>
	{
		const el = bubble();
		layout = installFakeLayout(
			el,
			{
				box: 652,
				pad: 32,
				lines: (w) => (w < 634 ? [600, 500, 300, 200] : three()),
			},
		);
		expect(
			{
				width: fitShrinkwrap(el),
				probes: layout.probes(),
			},
		).toEqual(
			{
				width: 634,
				probes: [632, 633, 634],
			},
		);
	});

	it("bisects from candidate+2 to the box width when the nudges also rewrap", () =>
	{
		const el = bubble();
		layout = installFakeLayout(
			el,
			{
				box: 652,
				pad: 32,
				lines: (w) => (w < 640 ? [600, 500, 300, 200] : three()),
			},
		);
		expect(
			{
				width: fitShrinkwrap(el),
				probes: layout.probes(),
			},
		).toEqual(
			{
				width: 640,
				probes: [632, 633, 634, 643, 638, 640, 639],
			},
		);
	});

	it("leaves no inline style when the widest line already fills the box", () =>
	{
		const el = bubble();
		layout = installFakeLayout(
			el,
			{
				box: 652,
				pad: 32,
				lines: () => [621, 400],
			},
		);
		expect(
			{
				width: fitShrinkwrap(el),
				style: el.style.maxWidth,
				probes: layout.probes(),
			},
		).toEqual(
			{
				width: null,
				style: "",
				probes: [],
			},
		);
	});

	it("gives up when the candidate makes the box shorter (shrank)", () =>
	{
		const el = bubble();
		layout = installFakeLayout(
			el,
			{
				box: 652,
				pad: 32,
				lines: three,
				height: (w) => (w < 652 ? 70 : 72),
			},
		);
		expect(
			{
				width: fitShrinkwrap(el),
				style: el.style.maxWidth,
			},
		).toEqual(
			{
				width: null,
				style: "",
			},
		);
	});

	it("ignores a data-shrinkwrap=fill row and an absolute child", () =>
	{
		const el = bubble(
			`<p>prompt text</p><div ${SHRINKWRAP_ATTR}="${SHRINKWRAP_FILL}"><span>Not delivered</span></div><a style="position:absolute">debug</a>`,
		);
		layout = installFakeLayout(
			el,
			{
				box: 652,
				pad: 32,
				lines: three,
				otherText: 640,
			},
		);
		expect(fitShrinkwrap(el)).toBe(632);
	});

	it("measures a fill-free wide row (the fake layout counts other text)", () =>
	{
		const el = bubble(`<p>prompt text</p><div><span>wide caption</span></div>`);
		layout = installFakeLayout(
			el,
			{
				box: 652,
				pad: 32,
				lines: three,
				otherText: 610,
			},
		);
		expect(fitShrinkwrap(el)).toBe(642);
	});

	it("restores an author-set inline max-width when there is nothing to fit", () =>
	{
		const el = bubble();
		el.style.maxWidth = "700px";
		layout = installFakeLayout(
			el,
			{
				box: 652,
				pad: 32,
				lines: () => [640],
			},
		);
		expect(
			{
				width: fitShrinkwrap(el),
				style: el.style.maxWidth,
			},
		).toEqual(
			{
				width: null,
				style: "700px",
			},
		);
	});

	it("returns null for an element with no text", () =>
	{
		const el = bubble("<div></div>");
		layout = installFakeLayout(
			el,
			{
				box: 652,
				pad: 32,
				lines: () => [],
			},
		);
		expect(fitShrinkwrap(el)).toBe(null);
	});
});
