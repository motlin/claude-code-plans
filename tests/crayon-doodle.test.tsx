// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {CrayonDoodle} from "../src/components/crayon-doodle";
import {crayonArt} from "../src/lib/crayon-art";

afterEach(() =>
{
	cleanup();
});

const DOCUMENT_STROKE_TRANSFORM = "translate(-14 6) rotate(7) scale(2.6)";

// dumps/artifact-cover-docs-back-sheet-doodle-bundle-doodle-cb2e35da5.js.txt: `G("document")`, checked against the
// live path `d` strings (1069/1069/670/670 chars) and group transform on 2026-11-06.
describe("crayonArt", () =>
{
	it("draws upstream's Docs art: two scribble lines, each a 1.4 stroke with a 1px copy 1.2 lower, at place 0", () =>
	{
		const art = crayonArt("document");
		expect(
			{
				...art,
				strokes: art.strokes.map(({d, width, transform}) => (
				{
					width,
					transform,
					length: d.length,
					start: d.slice(0, 24),
					end: d.slice(d.lastIndexOf("L")),
				})),
			},
		).toStrictEqual(
			{
				transform: "translate(94.3 64.0) scale(1.15) translate(-57.5 -40)",
				noiseSeed: 3,
				warp: 1.6,
				strokes: [
					{
						width: 1.4,
						transform: DOCUMENT_STROKE_TRANSFORM,
						length: 1069,
						start: "M0.0 0.0L0.5 1.4L1.0 2.7",
						end: "L60.0 6.9",
					},
					{
						width: 1,
						transform: DOCUMENT_STROKE_TRANSFORM,
						length: 1069,
						start: "M0.0 1.2L0.5 2.6L1.0 3.9",
						end: "L60.0 8.1",
					},
					{
						width: 1.4,
						transform: DOCUMENT_STROKE_TRANSFORM,
						length: 670,
						start: "M0.0 17.0L0.5 18.4L1.0 1",
						end: "L34.0 22.1",
					},
					{
						width: 1,
						transform: DOCUMENT_STROKE_TRANSFORM,
						length: 670,
						start: "M0.0 18.2L0.5 19.6L1.0 2",
						end: "L34.0 23.3",
					},
				],
			},
		);
		expect(art.strokes[0]?.d.endsWith("L59.5 7.5L60.0 6.9")).toBe(true);
	});
});

describe("CrayonDoodle", () =>
{
	function describeDoodle(span: Element | null)
	{
		const svg = span?.querySelector("svg");
		const filter = svg?.querySelector("defs > filter");
		const group = svg?.querySelector("g");
		return {
			tag: span?.tagName,
			ariaHidden: span?.getAttribute("aria-hidden"),
			className: span?.getAttribute("class"),
			svg: [svg?.getAttribute("viewBox"), svg?.getAttribute("preserveAspectRatio"), svg?.getAttribute("class")],
			filter: [
				filter?.getAttribute("x"),
				filter?.getAttribute("y"),
				filter?.getAttribute("width"),
				filter?.getAttribute("height"),
			],
			primitives: [...(filter?.children ?? [])].map((primitive) =>
				Object.fromEntries([...primitive.attributes].map((attribute) => [attribute.name, attribute.value])),
			),
			group: Object.fromEntries(
				[...(group?.attributes ?? [])]
					.filter((attribute) => attribute.name !== "filter")
					.map((attribute) => [attribute.name, attribute.value]),
			),
			groupFilter: group?.getAttribute("filter") === `url(#${filter?.id})`,
			paths: [...(group?.querySelectorAll("path") ?? [])].map((path) => [
				path.getAttribute("stroke-width"),
				path.getAttribute("transform"),
			]),
		};
	}

	it("renders upstream's faint doodle layer (`Y`): a masked 6% span over a grain-filtered stroke group", () =>
	{
		const {container} = render(<CrayonDoodle kind="document" faint />);
		expect(describeDoodle(container.firstElementChild)).toStrictEqual(
			{
				tag: "SPAN",
				ariaHidden: "true",
				className: "pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] opacity-[0.06]",
				svg: ["0 0 115 80", "xMidYMid slice", "block h-full w-full"],
				filter: ["-5%", "-5%", "110%", "110%"],
				primitives: [
					{
						type: "fractalNoise",
						baseFrequency: "0.9",
						numOctaves: "2",
						seed: "3",
						result: "noise",
					},
					{
						in: "SourceGraphic",
						in2: "noise",
						scale: "1.6",
						result: "warped",
					},
					{
						in: "noise",
						type: "matrix",
						values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 1.75",
						result: "grain",
					},
					{
						in: "warped",
						in2: "grain",
						operator: "in",
					},
				],
				group:
				{
					fill: "none",
					stroke: "currentColor",
					"stroke-linecap": "round",
					"stroke-linejoin": "round",
					transform: "translate(94.3 64.0) scale(1.15) translate(-57.5 -40)",
				},
				groupFilter: true,
				paths: [
					["1.4", DOCUMENT_STROKE_TRANSFORM],
					["1", DOCUMENT_STROKE_TRANSFORM],
					["1.4", DOCUMENT_STROKE_TRANSFORM],
					["1", DOCUMENT_STROKE_TRANSFORM],
				],
			},
		);
	});

	it("masks the doodle with upstream's radial gradient, as written (jsdom's CSSOM rewrites it)", () =>
	{
		const markup = renderToStaticMarkup(<CrayonDoodle kind="document" faint />);
		expect(/^<span [^>]*style="([^"]*)"/.exec(markup)?.[1]).toBe(
			"mask-image:radial-gradient(ellipse 44% 50% at 50% 50%, color-mix(in srgb, black 47%, transparent) 36%, black 100%)",
		);
	});

	it("draws the strip tiles' 12% doodle when not faint", () =>
	{
		const {container} = render(<CrayonDoodle kind="document" />);
		expect(container.firstElementChild?.getAttribute("class")).toBe(
			"pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] opacity-[0.12]",
		);
	});
});
