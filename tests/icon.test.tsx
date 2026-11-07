// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {Icon, IconSlot} from "../src/components/ui/icon";
import {DensityProvider} from "../src/components/ui/density";

afterEach(cleanup);

function svgOf(container: HTMLElement): SVGElement {
	const svgs = container.querySelectorAll("svg");
	expect(svgs.length).toBe(1);
	return svgs[0] as SVGElement;
}

function attrs(svg: Element, names: string[]): Record<string, string | null> {
	return Object.fromEntries(names.map((name) => [name, svg.getAttribute(name)]));
}

const CONTRACT_ATTRS = [
	"data-cds",
	"width",
	"height",
	"stroke-width",
	"aria-hidden",
	"role",
	"aria-label",
	"data-cds-mirror",
	"data-cds-rotate",
	"style",
];

describe("Icon (upstream cds Icon contract, lucide glyphs)", () => {
	it("renders an md svg[data-cds=Icon] at 1em, 1.25rem, aria-hidden, drawing a 1.25px stroke", () => {
		const {container} = render(<Icon name="Add" />);
		expect(attrs(svgOf(container), CONTRACT_ATTRS)).toStrictEqual({
			"data-cds": "Icon",
			width: "1em",
			height: "1em",
			"stroke-width": "1.5",
			"aria-hidden": "true",
			role: null,
			"aria-label": null,
			"data-cds-mirror": null,
			"data-cds-rotate": null,
			style: "flex-shrink: 0; font-size: calc(1.25rem * var(--cds-rem-scale, 1));",
		});
	});

	it("resolves size=auto from the density: 16px compact, 20px comfortable, both at a 1.25px stroke", () => {
		const read = (density: "compact" | "comfortable") => {
			const {container} = render(
				<DensityProvider density={density}>
					<Icon name="Search" size="auto" />
				</DensityProvider>,
			);
			const svg = svgOf(container);
			const result = {fontSize: svg.style.fontSize, stroke: svg.getAttribute("stroke-width")};
			cleanup();
			return result;
		};
		expect({compact: read("compact"), comfortable: read("comfortable")}).toStrictEqual({
			compact: {fontSize: "calc(1rem * var(--cds-rem-scale, 1))", stroke: "1.875"},
			comfortable: {fontSize: "calc(1.25rem * var(--cds-rem-scale, 1))", stroke: "1.5"},
		});
	});

	it("draws bold at the strong stroke (1.5625px at sm) and explicit sizes at their table strokes", () => {
		const stroke = (node: React.ReactElement) => {
			const {container} = render(node);
			const value = svgOf(container).getAttribute("stroke-width");
			cleanup();
			return value;
		};
		expect({
			boldSm: stroke(<Icon name="Check" size="sm" bold />),
			boldLg: stroke(<Icon name="Check" size="lg" bold />),
			xs: stroke(<Icon name="Check" size="xs" />),
			xl: stroke(<Icon name="Check" size="xl" />),
			custom18: stroke(<Icon name="Check" customSize={18} />),
		}).toStrictEqual({
			boldSm: "2.34375",
			boldLg: "1.5",
			xs: "2",
			xl: String((1.6667 * 24) / 28),
			custom18: String((1.25 * 24) / 18),
		});
	});

	it("marks upstream's Cb names data-cds-mirror and leaves others unmarked", () => {
		const mirror = (name: "ArrowRight" | "ArrowReturn" | "Add" | "CaretDown") => {
			const {container} = render(<Icon name={name} />);
			const value = svgOf(container).getAttribute("data-cds-mirror");
			cleanup();
			return value;
		};
		expect([mirror("ArrowRight"), mirror("ArrowReturn"), mirror("Add"), mirror("CaretDown")]).toStrictEqual([
			"",
			"",
			null,
			null,
		]);
	});

	it("sets data-cds-rotate and --cds-icon-rotate for a non-zero rotate only", () => {
		const read = (rotate: number) => {
			const {container} = render(<Icon name="CaretRight" rotate={rotate} />);
			const svg = svgOf(container);
			const result = {
				attr: svg.getAttribute("data-cds-rotate"),
				prop: svg.style.getPropertyValue("--cds-icon-rotate"),
			};
			cleanup();
			return result;
		};
		expect({ninety: read(90), zero: read(0)}).toStrictEqual({
			ninety: {attr: "", prop: "90deg"},
			zero: {attr: null, prop: ""},
		});
	});

	it("gives a meaningful icon role=img and its alt as the label, without aria-hidden", () => {
		const {container} = render(<Icon name="Stop" alt="Stop" />);
		expect(attrs(svgOf(container), ["role", "aria-label", "aria-hidden"])).toStrictEqual({
			role: "img",
			"aria-label": "Stop",
			"aria-hidden": null,
		});
	});

	it("draws DotsVertical as DotsHorizontal, as upstream's alias does", () => {
		const vertical = render(<Icon name="DotsVertical" />).container.innerHTML;
		cleanup();
		const horizontal = render(<Icon name="DotsHorizontal" />).container.innerHTML;
		expect(vertical).toBe(horizontal);
	});

	it("merges the caller's className and style over the computed ones", () => {
		const {container} = render(<Icon name="X" className="text-secondary" style={{fontSize: "10px"}} />);
		const svg = svgOf(container);
		expect({
			hasClass: svg.classList.contains("text-secondary"),
			fontSize: svg.style.fontSize,
		}).toStrictEqual({hasClass: true, fontSize: "10px"});
	});

	it("draws the Filled variants as solid glyphs", () => {
		const {container} = render(<Icon name="StopFilled" />);
		const svg = svgOf(container);
		expect({
			cds: svg.getAttribute("data-cds"),
			width: svg.getAttribute("width"),
			rect: attrs(svg.querySelector("rect") as Element, ["x", "y", "width", "height", "rx", "fill"]),
		}).toStrictEqual({
			cds: "Icon",
			width: "1em",
			rect: {x: "4", y: "4", width: "12", height: "12", rx: "2.5", fill: "currentColor"},
		});
	});

	it("draws upstream's CaretRightFilled as a solid triangle, mirrored under RTL", () => {
		const {container} = render(<Icon name="CaretRightFilled" size="sm" />);
		const svg = svgOf(container);
		expect({
			viewBox: svg.getAttribute("viewBox"),
			fontSize: svg.style.fontSize,
			mirror: svg.getAttribute("data-cds-mirror"),
			path: attrs(svg.querySelector("path") as Element, ["fill", "d"]),
		}).toStrictEqual({
			viewBox: "0 0 14 14",
			fontSize: "calc(1rem * var(--cds-rem-scale, 1))",
			mirror: "",
			path: {
				fill: "currentColor",
				d: "M5 3.4v7.2c0 .42.48.65.81.39l4.5-3.6a.5.5 0 0 0 0-.78l-4.5-3.6A.5.5 0 0 0 5 3.4Z",
			},
		});
	});

	it("rejects names outside the glyph map at the type level", () => {
		// @ts-expect-error NotAnIcon is not an Anthropicons name with a local glyph
		const node = <Icon name="NotAnIcon" />;
		expect(node.props).toStrictEqual({name: "NotAnIcon"});
	});
});

describe("IconSlot (upstream nd)", () => {
	it("wraps an auto Icon in the size-icon slot, or the first-line w-icon slot", () => {
		const slot = (firstLine: boolean) => {
			const {container} = render(<IconSlot icon="Add" firstLine={firstLine} />);
			const span = container.firstElementChild;
			const result = {
				className: span?.className,
				icon: span?.querySelector('svg[data-cds="Icon"]') !== null,
			};
			cleanup();
			return result;
		};
		expect({plain: slot(false), firstLine: slot(true)}).toStrictEqual({
			plain: {
				className:
					"flex size-icon shrink-0 items-center justify-center -my-[max(0px,calc((var(--cds-icon)_-_1lh)_/_2))]",
				icon: true,
			},
			firstLine: {className: "flex h-[1lh] w-icon shrink-0 items-center justify-center self-start", icon: true},
		});
	});

	it("passes a non-string icon through untouched", () => {
		const {container} = render(<IconSlot icon={<b data-testid="custom" />} />);
		expect(container.innerHTML).toBe(
			'<span class="flex size-icon shrink-0 items-center justify-center -my-[max(0px,calc((var(--cds-icon)_-_1lh)_/_2))]"><b data-testid="custom"></b></span>',
		);
	});
});
